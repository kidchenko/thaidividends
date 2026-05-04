import { writeFile, mkdir } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import YahooFinance from "yahoo-finance2";
import { SET50 } from "./set50.ts";

const yahooFinance = new YahooFinance();

const SINCE = new Date("2025-01-01T00:00:00Z");
const REQUEST_DELAY_MS = 250;

type DividendEvent = {
  symbol: string;
  exDate: string;
  amount: number | null;
  currency: string;
  upcoming?: boolean;
};

type Company = {
  symbol: string;
  longName: string | null;
  shortName: string | null;
  currency: string;
  exchange: string;
};

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchHistorical(yahooSymbol: string): Promise<{
  events: DividendEvent[];
  company: Company;
} | null> {
  const chart = await yahooFinance.chart(yahooSymbol, {
    period1: SINCE,
    period2: new Date(),
    interval: "1d",
    events: "div",
  });
  const meta = chart.meta;
  const company: Company = {
    symbol: yahooSymbol.replace(/\.BK$/, ""),
    longName: meta.longName ?? null,
    shortName: meta.shortName ?? null,
    currency: meta.currency ?? "THB",
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? "SET",
  };
  const divs = chart.events?.dividends ?? [];
  const events: DividendEvent[] = divs
    .map((d) => ({
      symbol: company.symbol,
      exDate: toIsoDate(d.date),
      amount: d.amount,
      currency: company.currency,
    }))
    .filter((e) => new Date(e.exDate) >= SINCE)
    .sort((a, b) => a.exDate.localeCompare(b.exDate));
  return { events, company };
}

async function fetchUpcoming(
  yahooSymbol: string,
  symbol: string,
  currency: string,
): Promise<DividendEvent | null> {
  try {
    const summary = await yahooFinance.quoteSummary(yahooSymbol, {
      modules: ["summaryDetail", "defaultKeyStatistics"],
    });
    const exDate = summary.summaryDetail?.exDividendDate;
    if (!exDate) return null;
    const exIso = toIsoDate(exDate);

    // Yahoo populates `defaultKeyStatistics.lastDividendValue` with the *upcoming*
    // amount when `lastDividendDate` equals the upcoming `exDividendDate`. The
    // field name is misleading; "last" here means "most recently announced".
    const dks = summary.defaultKeyStatistics;
    const lastDivDate = dks?.lastDividendDate ? toIsoDate(dks.lastDividendDate) : null;
    const lastDivValue = dks?.lastDividendValue ?? null;
    const amount = lastDivDate === exIso ? (lastDivValue ?? null) : null;

    return {
      symbol,
      exDate: exIso,
      amount,
      currency,
      upcoming: true,
    };
  } catch {
    return null;
  }
}

function mergeUpcoming(
  events: DividendEvent[],
  upcoming: DividendEvent | null,
  today: string,
): DividendEvent[] {
  if (!upcoming) return events;
  // If chart already has this date (post-event price drop), don't double-add.
  if (events.some((e) => e.exDate === upcoming.exDate)) return events;
  // Only add if it's today or future — past dates from quoteSummary mean the
  // chart simply hasn't backfilled yet, no value adding a duplicate-ish entry.
  if (upcoming.exDate < today) return events;
  return [...events, upcoming].sort((a, b) => a.exDate.localeCompare(b.exDate));
}

async function main() {
  await mkdir("data", { recursive: true });
  const all: DividendEvent[] = [];
  const companies: Company[] = [];
  const failures: Array<{ symbol: string; error: string }> = [];
  const today = toIsoDate(new Date());
  let withDividends = 0;
  let upcomingAdded = 0;

  for (const symbol of SET50) {
    const yahooSymbol = `${symbol}.BK`;
    try {
      const historical = await fetchHistorical(yahooSymbol);
      if (!historical) throw new Error("no historical data");
      const upcoming = await fetchUpcoming(yahooSymbol, symbol, historical.company.currency);
      const merged = mergeUpcoming(historical.events, upcoming, today);
      const wasAdded = merged.length > historical.events.length;
      if (wasAdded) upcomingAdded++;
      if (merged.length > 0) withDividends++;
      const upMark = wasAdded ? `  ★ upcoming ${upcoming!.exDate}` : "";
      console.log(
        `  ${symbol.padEnd(8)} ${String(merged.length).padStart(2)} events  ${historical.company.longName ?? ""}${upMark}`,
      );
      all.push(...merged);
      companies.push(historical.company);
    } catch (err) {
      const msg = (err as Error).message;
      console.log(`  ${symbol.padEnd(8)}  FAIL — ${msg}`);
      failures.push({ symbol, error: msg });
    }
    await sleep(REQUEST_DELAY_MS);
  }

  all.sort((a, b) => a.exDate.localeCompare(b.exDate) || a.symbol.localeCompare(b.symbol));
  companies.sort((a, b) => a.symbol.localeCompare(b.symbol));

  await writeFile("data/yahoo-dividends.json", JSON.stringify(all, null, 2));
  await writeFile("data/companies.json", JSON.stringify(companies, null, 2));

  const byYear = all.reduce<Record<string, number>>((acc, e) => {
    const y = e.exDate.slice(0, 4);
    acc[y] = (acc[y] ?? 0) + 1;
    return acc;
  }, {});

  console.log();
  console.log(`Tickers queried:    ${SET50.length}`);
  console.log(`With dividends:     ${withDividends}`);
  console.log(`Upcoming added:     ${upcomingAdded}`);
  console.log(`Failures:           ${failures.length}`);
  console.log(`Total events:       ${all.length} (since ${toIsoDate(SINCE)})`);
  for (const [y, n] of Object.entries(byYear).sort()) {
    console.log(`  ${y}: ${n} events`);
  }
}

main();
