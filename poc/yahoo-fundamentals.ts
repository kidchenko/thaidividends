import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import YahooFinance from "yahoo-finance2";

const ARGS = process.argv.slice(2);
const REFRESH = ARGS.includes("--refresh");
const ONLY = ARGS.find((a) => a.startsWith("--only="))?.slice("--only=".length);

const COMPANIES_PATH = "data/companies.json";
const OUTPUT_PATH = "data/fundamentals.json";
const REQUEST_DELAY_MS = 250;
const CHECKPOINT_EVERY = 50;
const HISTORY_START = "2016-01-01";

type Company = { symbol: string; name: string; currency: string };

type AnnualIncome = {
  fiscalYearEnd: string; // YYYY-MM-DD
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  ebitda: number | null;
  eps: number | null;
};

type AnnualCashflow = {
  fiscalYearEnd: string;
  operatingCashflow: number | null;
  capex: number | null;
  freeCashflow: number | null;
  dividendsPaid: number | null;
};

type QuarterlyIncome = {
  quarterEnd: string;        // YYYY-MM-DD
  revenue: number | null;
  netIncome: number | null;
  eps: number | null;
};

type QuarterlyCashflow = {
  quarterEnd: string;
  operatingCashflow: number | null;
  capex: number | null;
  freeCashflow: number | null;
  dividendsPaid: number | null;
};

type PriceSnapshot = {
  date: string;          // quarter-end YYYY-MM-DD
  close: number;         // raw (NOT dividend-adjusted) close — required for yield math
};

type StockSplit = {
  date: string;          // YYYY-MM-DD effective date
  numerator: number;     // e.g., 10 in 10:1
  denominator: number;   // e.g., 1 in 10:1
};

type CompanyProfile = {
  description: string | null;        // longBusinessSummary
  website: string | null;
  fullTimeEmployees: number | null;
  yahooIndustry: string | null;      // Yahoo's industry classification
  yahooSector: string | null;        // Yahoo's sector classification
};

type Fundamentals = {
  symbol: string;
  asOf: string;
  payoutRatio: number | null;
  debtToEquity: number | null;
  sharesOutstanding: number | null;
  incomeAnnual: AnnualIncome[];           // newest first
  cashflowAnnual: AnnualCashflow[];       // newest first
  quarterlyIncome: QuarterlyIncome[];     // newest first
  quarterlyCashflow: QuarterlyCashflow[]; // newest first
  priceQuarterEnds: PriceSnapshot[];      // newest first; quarter-end raw closes
  splits: StockSplit[];                   // chronological; needed to scale historical dividends
  profile: CompanyProfile;                // company description, website, etc.
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

async function loadCompanies(): Promise<Company[]> {
  const raw = await readFile(COMPANIES_PATH, "utf8");
  const all = JSON.parse(raw) as Company[];
  if (ONLY) {
    const set = new Set(ONLY.split(",").map((s) => s.trim().toUpperCase()));
    return all.filter((c) => set.has(c.symbol.toUpperCase()));
  }
  return all;
}

async function loadExisting(): Promise<Record<string, Fundamentals>> {
  // Always load — even with --refresh we want to preserve symbols outside the
  // filter (--only) instead of wiping them. Per-symbol fetch decision happens
  // in the main loop based on REFRESH + schema completeness.
  try {
    const raw = await readFile(OUTPUT_PATH, "utf8");
    return JSON.parse(raw) as Record<string, Fundamentals>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function fetchSymbol(symbol: string): Promise<Fundamentals> {
  const yahooSymbol = `${symbol}.BK`;

  // Key stats + asset profile (one call, multiple modules).
  const summary = await yahoo.quoteSummary(yahooSymbol, {
    modules: ["summaryDetail", "defaultKeyStatistics", "financialData", "assetProfile"],
  });

  await sleep(REQUEST_DELAY_MS);

  // Income statement history via fundamentalsTimeSeries (the older
  // incomeStatementHistory endpoint has been broken since Nov 2024).
  const incomeRows = await yahoo.fundamentalsTimeSeries(yahooSymbol, {
    period1: HISTORY_START,
    type: "annual",
    module: "financials",
  });

  await sleep(REQUEST_DELAY_MS);

  const cashflowRows = await yahoo.fundamentalsTimeSeries(yahooSymbol, {
    period1: HISTORY_START,
    type: "annual",
    module: "cash-flow",
  });

  await sleep(REQUEST_DELAY_MS);

  // Quarterly income for the EPS-history chart. Yahoo data has Q4-end gaps
  // (closes get filed late) — that's normal; downstream UI handles nulls.
  const quarterlyIncomeRows = await yahoo.fundamentalsTimeSeries(yahooSymbol, {
    period1: HISTORY_START,
    type: "quarterly",
    module: "financials",
  });

  await sleep(REQUEST_DELAY_MS);

  const quarterlyCashflowRows = await yahoo.fundamentalsTimeSeries(yahooSymbol, {
    period1: HISTORY_START,
    type: "quarterly",
    module: "cash-flow",
  });

  await sleep(REQUEST_DELAY_MS);

  // Historical price snapshots — monthly bars, then we keep only quarter-ends.
  // Raw close (NOT adjclose) so yield math doesn't double-count dividends.
  // Splits are needed to scale pre-split SET dividend amounts to match
  // Yahoo's split-adjusted prices.
  const chart = await yahoo.chart(yahooSymbol, {
    period1: HISTORY_START,
    period2: new Date(),
    interval: "1mo",
    events: "split",
  });

  // Sort newest first.
  const incomeAnnual: AnnualIncome[] = [...incomeRows]
    .map((r) => ({
      fiscalYearEnd: toIsoDate(r.date) ?? "",
      revenue: n(r.totalRevenue),
      grossProfit: n(r.grossProfit),
      operatingIncome: n(r.operatingIncome),
      netIncome: n(r.netIncome),
      ebitda: n(r.EBITDA),
      eps: n(r.basicEPS) ?? n(r.dilutedEPS),
    }))
    .sort((a, b) => b.fiscalYearEnd.localeCompare(a.fiscalYearEnd));

  const quarterlyIncome: QuarterlyIncome[] = [...quarterlyIncomeRows]
    .map((r) => ({
      quarterEnd: toIsoDate(r.date) ?? "",
      revenue: n(r.totalRevenue),
      netIncome: n(r.netIncome),
      eps: n(r.basicEPS) ?? n(r.dilutedEPS),
    }))
    .filter((r) => r.quarterEnd)
    .sort((a, b) => b.quarterEnd.localeCompare(a.quarterEnd));

  const splits: StockSplit[] = Object.values((chart.events as { splits?: Record<string, { date: Date; numerator: number; denominator: number }> } | undefined)?.splits ?? {})
    .map((s) => ({
      date: toIsoDate(s.date) ?? "",
      numerator: s.numerator,
      denominator: s.denominator,
    }))
    .filter((s) => s.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const priceQuarterEnds: PriceSnapshot[] = (chart.quotes ?? [])
    .filter((q) => {
      if (!q.date || typeof q.close !== "number") return false;
      const m = q.date.getUTCMonth();
      return m === 2 || m === 5 || m === 8 || m === 11; // Mar/Jun/Sep/Dec
    })
    .map((q) => ({
      date: toIsoDate(q.date) ?? "",
      close: q.close as number,
    }))
    .filter((p) => p.date)
    .sort((a, b) => b.date.localeCompare(a.date));

  const quarterlyCashflow: QuarterlyCashflow[] = [...quarterlyCashflowRows]
    .map((r) => {
      const ocf = n(r.operatingCashFlow);
      const capex = n(r.capitalExpenditure);
      const fcfDirect = n(r.freeCashFlow);
      return {
        quarterEnd: toIsoDate(r.date) ?? "",
        operatingCashflow: ocf,
        capex,
        freeCashflow:
          fcfDirect ?? (ocf !== null && capex !== null ? ocf + capex : null),
        dividendsPaid: n(r.cashDividendsPaid),
      };
    })
    .filter((r) => r.quarterEnd)
    .sort((a, b) => b.quarterEnd.localeCompare(a.quarterEnd));

  const cashflowAnnual: AnnualCashflow[] = [...cashflowRows]
    .map((r) => {
      const ocf = n(r.operatingCashFlow);
      const capex = n(r.capitalExpenditure);
      const fcfDirect = n(r.freeCashFlow);
      return {
        fiscalYearEnd: toIsoDate(r.date) ?? "",
        operatingCashflow: ocf,
        capex,
        freeCashflow:
          fcfDirect ?? (ocf !== null && capex !== null ? ocf + capex : null), // capex is negative
        dividendsPaid: n(r.cashDividendsPaid),
      };
    })
    .sort((a, b) => b.fiscalYearEnd.localeCompare(a.fiscalYearEnd));

  return {
    symbol,
    asOf: todayIso(),
    payoutRatio: n(summary.summaryDetail?.payoutRatio),
    debtToEquity: n(summary.financialData?.debtToEquity),
    sharesOutstanding: n(summary.defaultKeyStatistics?.sharesOutstanding),
    incomeAnnual,
    cashflowAnnual,
    quarterlyIncome,
    quarterlyCashflow,
    priceQuarterEnds,
    splits,
    profile: {
      description: summary.assetProfile?.longBusinessSummary ?? null,
      website: summary.assetProfile?.website ?? null,
      fullTimeEmployees: summary.assetProfile?.fullTimeEmployees ?? null,
      yahooIndustry: summary.assetProfile?.industry ?? null,
      yahooSector: summary.assetProfile?.sector ?? null,
    },
  };
}

function summarizeCoverage(d: Fundamentals): string {
  const incomeYears = d.incomeAnnual.filter((y) => y.netIncome !== null).length;
  const cfYears = d.cashflowAnnual.filter((y) => y.operatingCashflow !== null).length;
  const flags: string[] = [];
  flags.push(`income:${incomeYears}y`);
  flags.push(`cf:${cfYears}y`);
  if (d.payoutRatio !== null) flags.push("payout✓");
  return flags.join(" ");
}

async function main() {
  await mkdir("data", { recursive: true });
  const companies = await loadCompanies();
  const existing = await loadExisting();
  const fundamentals: Record<string, Fundamentals> = { ...existing };

  console.log(
    `Yahoo fundamentals fetch — ${companies.length} symbols (${REFRESH ? "REFRESH all" : `resume; ${Object.keys(existing).length} already cached`})`,
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
    const cached = fundamentals[c.symbol];
    // Re-fetch when --refresh is set OR when cached entry is missing a schema
    // field (auto-upgrade for new fields like quarterlyIncome / quarterlyCashflow).
    const cachedAny = cached as {
      quarterlyIncome?: unknown;
      quarterlyCashflow?: unknown;
      priceQuarterEnds?: unknown;
      splits?: unknown;
      profile?: unknown;
    } | undefined;
    const isComplete = cached
      && Array.isArray(cachedAny?.quarterlyIncome)
      && Array.isArray(cachedAny?.quarterlyCashflow)
      && Array.isArray(cachedAny?.priceQuarterEnds)
      && Array.isArray(cachedAny?.splits)
      && cachedAny?.profile != null
      && typeof cachedAny.profile === "object";
    if (!REFRESH && isComplete) {
      skipped++;
      continue;
    }
    process.stdout.write(`${prefix} ... `);
    try {
      const data = await fetchSymbol(c.symbol);
      console.log(`OK (${summarizeCoverage(data)})`);
      fundamentals[c.symbol] = data;
      fetched++;
    } catch (err) {
      const msg = (err as Error).message;
      console.log(`FAIL — ${msg}`);
      failures.push({ symbol: c.symbol, error: msg });
    }

    if (fetched > 0 && fetched % CHECKPOINT_EVERY === 0) {
      await writeFile(OUTPUT_PATH, JSON.stringify(fundamentals, null, 2));
      console.log(`  ↳ checkpoint: wrote ${Object.keys(fundamentals).length} symbols to ${OUTPUT_PATH}`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  await writeFile(OUTPUT_PATH, JSON.stringify(fundamentals, null, 2));

  console.log();
  console.log(`Symbols cached:        ${Object.keys(fundamentals).length}`);
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
