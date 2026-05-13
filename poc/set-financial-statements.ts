// Pulls historical earnings release dates from SET news, filtered by
// `keyword=Financial Statement`. SET doesn't expose a structured release-date
// field per quarter, but its news feed includes one item per filed statement
// with the actual filing datetime and a headline we can parse for period.
//
// Headlines look like:
//   "Financial Statement Quarter 1/2026 (Reviewed)"
//   "Financial Statement Yearly 2025 (Audited)"
//   "Financial Statement Yearly 2025 (Audited) (Revised)"
//
// Output is keyed by symbol; each entry has up-to-N releases newest-first,
// deduped by period (Yearly maps to Q4 of that fiscal year — same quarter-end
// either way).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type Page } from "patchright";

const ARGS = process.argv.slice(2);
const REFRESH = ARGS.includes("--refresh");
const ONLY = ARGS.find((a) => a.startsWith("--only="))?.slice("--only=".length);

const COMPANIES_PATH = "data/companies.json";
const OUTPUT_PATH = "data/set-financial-statements.json";
const BOOTSTRAP_URL = "https://www.set.or.th/en/market/stock-calendar/x-calendar";
const LOOKBACK_MONTHS = 18;
const PER_SYMBOL_DELAY_MS = 250;
const CHECKPOINT_EVERY = 100;
const STALE_AFTER_DAYS = 7;
const NAV_TIMEOUT_MS = 45_000;
const RESPONSE_WAIT_MS = 30_000;

type Company = { symbol: string };

type Release = {
  date: string;            // YYYY-MM-DD (filing datetime, date part)
  period: string;          // "Q1/2026" | "Q4/2025" (Yearly → Q4)
  isAnnual: boolean;       // headline was "Yearly", not "Quarter"
  isAudited: boolean;
  isRevised: boolean;
  headline: string;
};

type SymbolReleases = {
  symbol: string;
  asOf: string;            // YYYY-MM-DD
  releases: Release[];     // newest first
};

type NewsItem = { datetime: string; headline: string };
type NewsResponse = { totalCount: number; newsInfoList: NewsItem[] };

function fmtSetDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}%2F${mm}%2F${d.getFullYear()}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}

function parseHeadline(headline: string): Omit<Release, "date" | "headline"> | null {
  const audited = /\(Audited\)/i.test(headline);
  const revised = /\(Revised\)/i.test(headline);
  // Standard quarterly form (most non-financial companies).
  const qMatch = headline.match(/Quarter\s+(\d)\/(\d{4})/i);
  if (qMatch) {
    return { period: `Q${qMatch[1]}/${qMatch[2]}`, isAnnual: false, isAudited: audited, isRevised: revised };
  }
  // Banks file H1 instead of Q2 ("Financial Statement Half Year 2025").
  const hMatch = headline.match(/Half\s+Year\s+(\d{4})/i);
  if (hMatch) {
    return { period: `Q2/${hMatch[1]}`, isAnnual: false, isAudited: audited, isRevised: revised };
  }
  // Some filers use Nine Month(s) for Q3.
  const nMatch = headline.match(/Nine\s+Month(?:s)?\s+(\d{4})/i);
  if (nMatch) {
    return { period: `Q3/${nMatch[1]}`, isAnnual: false, isAudited: audited, isRevised: revised };
  }
  // Annual filing covers Q4 of the fiscal year.
  const yMatch = headline.match(/Yearly\s+(\d{4})/i);
  if (yMatch) {
    return { period: `Q4/${yMatch[1]}`, isAnnual: true, isAudited: audited, isRevised: revised };
  }
  return null;
}

async function bootstrap(page: Page): Promise<void> {
  const wait = page.waitForResponse(
    (r) => r.url().includes("/api/set/stock-calendar/") && r.status() === 200,
    { timeout: RESPONSE_WAIT_MS },
  );
  await page.goto(BOOTSTRAP_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  await wait;
}

async function fetchSymbol(page: Page, symbol: string, fromStr: string, toStr: string): Promise<Release[]> {
  const url = `/api/set/news/search?symbol=${symbol}&fromDate=${fromStr}&toDate=${toStr}&keyword=Financial%20Statement&lang=en`;
  const payload = (await page.evaluate(async (u) => {
    const res = await fetch(u, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, url)) as NewsResponse;

  const releases: Release[] = [];
  for (const item of payload.newsInfoList ?? []) {
    if (!item.headline?.toLowerCase().startsWith("financial statement")) continue;
    const parsed = parseHeadline(item.headline);
    if (!parsed) continue;
    releases.push({
      date: item.datetime.slice(0, 10),
      headline: item.headline,
      ...parsed,
    });
  }

  // Dedupe by period. Items arrive newest-first; first match wins, so
  // (Audited)(Revised) takes precedence over the earlier (Reviewed) for the
  // same fiscal period.
  const seen = new Set<string>();
  return releases.filter((r) => (seen.has(r.period) ? false : (seen.add(r.period), true)));
}

function shouldFetch(cached: SymbolReleases | undefined): boolean {
  if (REFRESH) return true;
  if (!cached) return true;
  if (daysBetween(cached.asOf, todayIso()) >= STALE_AFTER_DAYS) return true;
  return false;
}

async function loadCompanies(): Promise<Company[]> {
  const raw = await readFile(COMPANIES_PATH, "utf8");
  const all = JSON.parse(raw) as Company[];
  if (ONLY) {
    const set = new Set(ONLY.split(",").map((s) => s.trim().toUpperCase()));
    return all.filter((c) => set.has(c.symbol.toUpperCase()));
  }
  return all;
}

async function loadExisting(): Promise<Record<string, SymbolReleases>> {
  try {
    const raw = await readFile(OUTPUT_PATH, "utf8");
    return JSON.parse(raw) as Record<string, SymbolReleases>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function main() {
  await mkdir("data", { recursive: true });
  const companies = await loadCompanies();
  const existing = await loadExisting();
  const out: Record<string, SymbolReleases> = { ...existing };

  console.log(
    `SET financial-statements — ${companies.length} symbols (${REFRESH ? "REFRESH all" : `resume; ${Object.keys(existing).length} cached`})`,
  );
  if (ONLY) console.log(`Filter: --only=${ONLY}`);
  console.log();

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    timezoneId: "Asia/Bangkok",
  });
  const page = await ctx.newPage();
  console.log("Bootstrapping browser context (Incapsula)...");
  await bootstrap(page);
  console.log("Bootstrap OK.\n");

  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setMonth(fromDate.getMonth() - LOOKBACK_MONTHS);
  const fromStr = fmtSetDate(fromDate);
  const toStr = fmtSetDate(toDate);

  const failures: Array<{ symbol: string; error: string }> = [];
  let i = 0, fetched = 0, skipped = 0;

  for (const c of companies) {
    i++;
    const prefix = `[${String(i).padStart(4)}/${companies.length}] ${c.symbol}`;
    if (!shouldFetch(out[c.symbol])) {
      skipped++;
      continue;
    }
    process.stdout.write(`${prefix} ... `);
    try {
      const releases = await fetchSymbol(page, c.symbol, fromStr, toStr);
      out[c.symbol] = { symbol: c.symbol, asOf: todayIso(), releases };
      console.log(`${releases.length} releases`);
      fetched++;
    } catch (err) {
      const msg = (err as Error).message;
      console.log(`FAIL - ${msg}`);
      failures.push({ symbol: c.symbol, error: msg });
    }
    if (fetched > 0 && fetched % CHECKPOINT_EVERY === 0) {
      await writeFile(OUTPUT_PATH, JSON.stringify(out, null, 2));
      console.log(`  checkpoint: wrote ${Object.keys(out).length} symbols`);
    }
    await sleep(PER_SYMBOL_DELAY_MS);
  }

  await browser.close();
  await writeFile(OUTPUT_PATH, JSON.stringify(out, null, 2));

  console.log();
  console.log(`Symbols cached:        ${Object.keys(out).length}`);
  console.log(`Newly fetched:         ${fetched}`);
  console.log(`Resumed (skipped):     ${skipped}`);
  console.log(`Failures:              ${failures.length}`);
  console.log(`Wrote -> ${OUTPUT_PATH}`);

  if (failures.length > 0) {
    console.log();
    console.log("Failures (re-run to retry):");
    for (const f of failures.slice(0, 20)) console.log(`  ${f.symbol}: ${f.error}`);
    if (failures.length > 20) console.log(`  ... and ${failures.length - 20} more`);
  }
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});
