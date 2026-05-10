import setStatsData from "../../data/set-trading-stat.json";

export type SetTradingStatRow = {
  period: string;             // "2022" | "YTD"
  date: string | null;        // YYYY-MM-DD
  close: number | null;
  pe: number | null;
  pbv: number | null;
  bookValuePerShare: number | null;
  dividendYield: number | null;       // percent, e.g. 6.3 means 6.3%
  dividendPayoutRatio: number | null; // ratio, 0.5 means 50%
  marketCap: number | null;
  listedShare: number | null;
  beta: number | null;
  financialDate: string | null;
};

type SetStatsData = {
  asOf: string;
  data: Record<string, SetTradingStatRow[]>;
};

const STATS = setStatsData as unknown as SetStatsData;

export function getSetTradingStat(symbol: string): SetTradingStatRow[] | null {
  return STATS.data?.[symbol] ?? null;
}

/**
 * Returns a year → row lookup keyed by integer year. The "YTD" row is excluded
 * (it's a partial-year snapshot, not a closed fiscal year).
 */
export function getSetAnnualByYear(symbol: string): Map<number, SetTradingStatRow> {
  const rows = getSetTradingStat(symbol) ?? [];
  const out = new Map<number, SetTradingStatRow>();
  for (const r of rows) {
    const y = Number(r.period);
    if (Number.isFinite(y)) out.set(y, r);
  }
  return out;
}

export function getSetStatsAsOf(): string {
  return STATS.asOf;
}
