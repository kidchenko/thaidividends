import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import YahooFinance from "yahoo-finance2";

const ARGS = process.argv.slice(2);
const REFRESH = ARGS.includes("--refresh");
const ONLY = ARGS.find((a) => a.startsWith("--only="))?.slice("--only=".length);

const COMPANIES_PATH = "data/companies.json";
const OUTPUT_PATH = "data/earnings.json";
const REQUEST_DELAY_MS = 250;
const CHECKPOINT_EVERY = 50;
const STALE_AFTER_DAYS = 7;

type Company = { symbol: string; name: string; currency: string };

type NextEarnings = {
  earningsDate: string | null;       // YYYY-MM-DD, earliest of Yahoo's window
  earningsDateEnd: string | null;    // YYYY-MM-DD, latest if Yahoo gave a range
  epsEstimate: number | null;
  revenueEstimate: number | null;
};

type HistoryRow = {
  quarter: string;                   // YYYY-MM-DD quarter-end
  epsActual: number | null;
  epsEstimate: number | null;
  surprisePercent: number | null;
};

type EarningsRecord = {
  symbol: string;
  asOf: string;                      // YYYY-MM-DD of last fetch
  next: NextEarnings | null;
  history: HistoryRow[];             // newest first
};

const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

function toIsoDate(d: Date | string | undefined | null): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function n(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && "raw" in v) {
    const raw = (v as { raw: unknown }).raw;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  }
  return null;
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
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

async function loadExisting(): Promise<Record<string, EarningsRecord>> {
  try {
    const raw = await readFile(OUTPUT_PATH, "utf8");
    return JSON.parse(raw) as Record<string, EarningsRecord>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function fetchSymbol(symbol: string): Promise<EarningsRecord> {
  const yahooSymbol = `${symbol}.BK`;
  const summary = await yahoo.quoteSummary(yahooSymbol, {
    modules: ["calendarEvents", "earningsHistory"],
  });

  // calendarEvents.earnings.earningsDate is usually a 1- or 2-element Date array
  // (Yahoo reports a window when the exact date isn't confirmed yet).
  const ce = summary.calendarEvents as
    | { earnings?: { earningsDate?: Date[]; earningsAverage?: unknown; revenueAverage?: unknown } }
    | undefined;
  const dates = ce?.earnings?.earningsDate ?? [];
  const next: NextEarnings | null = dates.length > 0
    ? {
        earningsDate: toIsoDate(dates[0]),
        earningsDateEnd: dates.length > 1 ? toIsoDate(dates[dates.length - 1]) : null,
        epsEstimate: n(ce?.earnings?.earningsAverage),
        revenueEstimate: n(ce?.earnings?.revenueAverage),
      }
    : null;

  const eh = summary.earningsHistory as
    | { history?: Array<{ quarter?: Date; epsActual?: unknown; epsEstimate?: unknown; surprisePercent?: unknown }> }
    | undefined;
  const history: HistoryRow[] = (eh?.history ?? [])
    .map((h) => ({
      quarter: toIsoDate(h.quarter) ?? "",
      epsActual: n(h.epsActual),
      epsEstimate: n(h.epsEstimate),
      surprisePercent: n(h.surprisePercent),
    }))
    .filter((h) => h.quarter)
    .sort((a, b) => b.quarter.localeCompare(a.quarter));

  return { symbol, asOf: todayIso(), next, history };
}

function summarizeCoverage(d: EarningsRecord): string {
  const flags: string[] = [];
  flags.push(`hist:${d.history.length}q`);
  if (d.next?.earningsDate) {
    flags.push(`next:${d.next.earningsDate}`);
  } else {
    flags.push("next:—");
  }
  return flags.join(" ");
}

// Refresh policy: per-symbol. We refetch when:
//   • --refresh is set, OR
//   • cached entry is missing schema fields (auto-upgrade), OR
//   • cached.asOf is older than STALE_AFTER_DAYS, OR
//   • cached.next.earningsDate is in the past (release happened — pull new "next")
function shouldFetch(cached: EarningsRecord | undefined): boolean {
  if (REFRESH) return true;
  if (!cached) return true;
  if (!Array.isArray(cached.history)) return true;
  if (typeof cached.asOf !== "string") return true;
  if (daysBetween(cached.asOf, todayIso()) >= STALE_AFTER_DAYS) return true;
  if (cached.next?.earningsDate && cached.next.earningsDate < todayIso()) return true;
  return false;
}

async function main() {
  await mkdir("data", { recursive: true });
  const companies = await loadCompanies();
  const existing = await loadExisting();
  const earnings: Record<string, EarningsRecord> = { ...existing };

  console.log(
    `Yahoo earnings fetch — ${companies.length} symbols (${REFRESH ? "REFRESH all" : `resume; ${Object.keys(existing).length} already cached`})`,
  );
  if (ONLY) console.log(`Filter: --only=${ONLY}`);
  console.log();

  const failures: Array<{ symbol: string; error: string }> = [];
  let i = 0;
  let fetched = 0;
  let skipped = 0;

  for (const c of companies) {
    i++;
    const prefix = `[${String(i).padStart(4)}/${companies.length}] ${c.symbol}`;
    const cached = earnings[c.symbol];

    if (!shouldFetch(cached)) {
      skipped++;
      continue;
    }

    process.stdout.write(`${prefix} ... `);
    try {
      const data = await fetchSymbol(c.symbol);
      console.log(`OK (${summarizeCoverage(data)})`);
      earnings[c.symbol] = data;
      fetched++;
    } catch (err) {
      const msg = (err as Error).message;
      console.log(`FAIL — ${msg}`);
      failures.push({ symbol: c.symbol, error: msg });
    }

    if (fetched > 0 && fetched % CHECKPOINT_EVERY === 0) {
      await writeFile(OUTPUT_PATH, JSON.stringify(earnings, null, 2));
      console.log(`  ↳ checkpoint: wrote ${Object.keys(earnings).length} symbols to ${OUTPUT_PATH}`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  await writeFile(OUTPUT_PATH, JSON.stringify(earnings, null, 2));

  const withNext = Object.values(earnings).filter((e) => e.next?.earningsDate).length;
  const withHistory = Object.values(earnings).filter((e) => e.history.length > 0).length;

  console.log();
  console.log(`Symbols cached:        ${Object.keys(earnings).length}`);
  console.log(`  with next date:      ${withNext}`);
  console.log(`  with history:        ${withHistory}`);
  console.log(`Newly fetched:         ${fetched}`);
  console.log(`Resumed (skipped):     ${skipped}`);
  console.log(`Failures:              ${failures.length}`);
  console.log();
  console.log(`Wrote → ${OUTPUT_PATH}`);

  if (failures.length > 0) {
    console.log();
    console.log("Failures (re-run to retry; --refresh to force re-fetch all):");
    for (const f of failures.slice(0, 20)) console.log(`  ${f.symbol}: ${f.error}`);
    if (failures.length > 20) console.log(`  ... and ${failures.length - 20} more`);
  }
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});
