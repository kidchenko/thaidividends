import earningsData from "../../data/earnings.json";
import statementsData from "../../data/set-financial-statements.json";

export type NextEarnings = {
  earningsDate: string | null;
  earningsDateEnd: string | null;
  epsEstimate: number | null;
  revenueEstimate: number | null;
};

export type EarningsHistoryRow = {
  quarter: string;            // YYYY-MM-DD
  epsActual: number | null;
  epsEstimate: number | null;
  surprisePercent: number | null;
};

export type EarningsRecord = {
  symbol: string;
  asOf: string;
  next: NextEarnings | null;
  history: EarningsHistoryRow[];
};

// SET news release — one per filed financial statement. Yearly filings map to
// Q4 of the fiscal year so a Q4 entry isn't double-counted.
export type Release = {
  date: string;            // YYYY-MM-DD (filing date)
  period: string;          // "Q1/2026" | "Q4/2025"
  isAnnual: boolean;
  isAudited: boolean;
  isRevised: boolean;
  headline: string;
};
type SymbolReleases = { symbol: string; asOf: string; releases: Release[] };

const EARNINGS = earningsData as unknown as Record<string, EarningsRecord>;
const RELEASES = statementsData as unknown as Record<string, SymbolReleases>;

export function getEarnings(symbol: string): EarningsRecord | null {
  return EARNINGS[symbol] ?? null;
}

export function getNextEarnings(symbol: string): NextEarnings | null {
  return EARNINGS[symbol]?.next ?? null;
}

export function getEarningsHistory(symbol: string): EarningsHistoryRow[] {
  return EARNINGS[symbol]?.history ?? [];
}

export function getReleases(symbol: string): Release[] {
  return RELEASES[symbol]?.releases ?? [];
}
