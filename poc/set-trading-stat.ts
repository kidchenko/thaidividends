/**
 * Fetch SET's annual trading-stat (year-end close, PE, PBV, dividend yield,
 * payout ratio, market cap, beta) for every symbol in data/companies.json.
 *
 * SET only exposes the last 4 fiscal years + YTD per symbol — same shape as
 * the website's "Trading Statistics" highlight box.  We use these as the
 * official year-end valuation snapshot, layered on top of Yahoo data.
 *
 * Output: data/set-trading-stat.json
 *   {
 *     asOf: "<ISO timestamp>",
 *     data: {
 *       PTT: [
 *         { period: "2022" | "YTD", date: "2022-12-30", close, pe, pbv,
 *           dividendYield, dividendPayoutRatio, marketCap, listedShare,
 *           beta, financialDate }, ...
 *       ]
 *     }
 *   }
 *
 * Usage:
 *   npx tsx poc/set-trading-stat.ts            # incremental (skip cached)
 *   npx tsx poc/set-trading-stat.ts --refresh  # re-fetch all
 *   npx tsx poc/set-trading-stat.ts --only=PTT,KBANK
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type BrowserContext, type Page } from "patchright";

const ARGS = process.argv.slice(2);
const REFRESH = ARGS.includes("--refresh");
const ONLY = ARGS.find((a) => a.startsWith("--only="))?.slice("--only=".length);

const COMPANIES_PATH = "data/companies.json";
const OUTPUT_PATH = "data/set-trading-stat.json";
const PAGE_URL = "https://www.set.or.th/en/market/stock-calendar/x-calendar";
const NAV_TIMEOUT_MS = 45_000;
const RESPONSE_WAIT_MS = 30_000;
const REQUEST_DELAY_MS = 350;
const CHECKPOINT_EVERY = 50;

type Company = { symbol: string; name: string; currency: string };

type RawTradingStat = {
  date: string | null;
  period: string | null;
  symbol: string;
  prior: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  pe: number | null;
  pbv: number | null;
  bookValuePerShare: number | null;
  dividendYield: number | null;
  dividendPayoutRatio: number | null;
  marketCap: number | null;
  listedShare: number | null;
  beta: number | null;
  financialDate: string | null;
};

export type SetTradingStatRow = {
  period: string;             // "2022" | "YTD"
  date: string | null;        // ISO yyyy-mm-dd of the year-end (or current date for YTD)
  close: number | null;
  pe: number | null;
  pbv: number | null;
  bookValuePerShare: number | null;
  dividendYield: number | null;       // already a percent (e.g. 6.3 for 6.3%)
  dividendPayoutRatio: number | null; // ratio (0.5 = 50%)
  marketCap: number | null;
  listedShare: number | null;
  beta: number | null;
  financialDate: string | null;
};

type Output = { asOf: string; data: Record<string, SetTradingStatRow[]> };

function isoDate(stamp: string | null): string | null {
  if (!stamp) return null;
  const m = stamp.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function normalize(rows: RawTradingStat[]): SetTradingStatRow[] {
  return rows.map((r) => ({
    period: r.period ?? "",
    date: isoDate(r.date),
    close: r.close,
    pe: r.pe,
    pbv: r.pbv,
    bookValuePerShare: r.bookValuePerShare,
    dividendYield: r.dividendYield,
    dividendPayoutRatio: r.dividendPayoutRatio,
    marketCap: r.marketCap,
    listedShare: r.listedShare,
    beta: r.beta,
    financialDate: isoDate(r.financialDate),
  }));
}

async function bootstrap(page: Page): Promise<void> {
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes("/api/set/stock-calendar/") && r.status() === 200,
    { timeout: RESPONSE_WAIT_MS },
  );
  await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  await responsePromise;
}

async function fetchSymbol(page: Page, symbol: string): Promise<SetTradingStatRow[]> {
  const url = `/api/set/stock/${symbol}/company-highlight/trading-stat?lang=en`;
  const payload = await page.evaluate(async (u) => {
    const res = await fetch(u, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, url);
  if (!Array.isArray(payload)) return [];
  return normalize(payload as RawTradingStat[]);
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

async function loadExisting(): Promise<Output> {
  try {
    const raw = await readFile(OUTPUT_PATH, "utf8");
    return JSON.parse(raw) as Output;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { asOf: "", data: {} };
    throw err;
  }
}

async function main() {
  await mkdir("data", { recursive: true });
  const companies = await loadCompanies();
  const existing = await loadExisting();
  const data: Record<string, SetTradingStatRow[]> = { ...existing.data };

  console.log(
    `SET trading-stat fetch — ${companies.length} symbols (${REFRESH ? "REFRESH all" : `resume; ${Object.keys(existing.data).length} already cached`})`,
  );
  if (ONLY) console.log(`Filter: --only=${ONLY}`);
  console.log();

  const browser = await chromium.launch({ headless: true });
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    timezoneId: "Asia/Bangkok",
  });
  const page = await ctx.newPage();

  console.log("Bootstrapping browser context (Incapsula warmup)...");
  await bootstrap(page);
  console.log("Bootstrap OK.\n");

  const failures: Array<{ symbol: string; error: string }> = [];
  let i = 0;
  let fetched = 0;
  let skipped = 0;

  for (const c of companies) {
    i++;
    const prefix = `[${String(i).padStart(4)}/${companies.length}] ${c.symbol}`;
    if (!REFRESH && Array.isArray(data[c.symbol])) {
      skipped++;
      continue;
    }
    process.stdout.write(`${prefix} ... `);
    try {
      const rows = await fetchSymbol(page, c.symbol);
      console.log(`OK (${rows.length} periods)`);
      data[c.symbol] = rows;
      fetched++;
    } catch (err) {
      const msg = (err as Error).message;
      console.log(`FAIL — ${msg}`);
      failures.push({ symbol: c.symbol, error: msg });
    }

    if (fetched > 0 && fetched % CHECKPOINT_EVERY === 0) {
      await writeFile(
        OUTPUT_PATH,
        JSON.stringify({ asOf: new Date().toISOString(), data }, null, 2),
      );
      console.log(`  ↳ checkpoint: wrote ${Object.keys(data).length} symbols`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  await browser.close();

  const output: Output = { asOf: new Date().toISOString(), data };
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log();
  console.log(`Symbols cached:        ${Object.keys(data).length}`);
  console.log(`Newly fetched:         ${fetched}`);
  console.log(`Resumed (skipped):     ${skipped}`);
  console.log(`Failures:              ${failures.length}`);
  console.log();
  console.log(`Wrote → ${OUTPUT_PATH}`);

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
