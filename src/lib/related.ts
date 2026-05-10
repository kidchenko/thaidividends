import companiesData from "../../data/companies.json";
import dividends from "../../data/set-dividends.json";
import { todayIso, type Company, type DividendEvent } from "./dividends";
import { computeCurrentYield, getPrice } from "./prices";

export type RelatedCompany = {
  symbol: string;
  name: string;
  industry: string | null;
  sector: string | null;
  ttmAmount: number;
  eventCount: number;
  currentYield: number | null;
};

type SymbolStats = { ttm: number; events: number; lastEx: string | null };

const COMPANIES = companiesData as Company[];

// Single pass over the full dividend log. The result is reused across both
// related + popular lookups on every stock page build.
let _stats: Map<string, SymbolStats> | null = null;
function buildStats(): Map<string, SymbolStats> {
  if (_stats) return _stats;
  const today = todayIso();
  const cutoff = (() => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const m = new Map<string, SymbolStats>();
  for (const e of dividends as DividendEvent[]) {
    const cur = m.get(e.symbol) ?? { ttm: 0, events: 0, lastEx: null };
    cur.events += 1;
    if (typeof e.amount === "number" && e.exDate >= cutoff && e.exDate <= today) {
      cur.ttm += e.amount;
    }
    if (cur.lastEx === null || e.exDate > cur.lastEx) cur.lastEx = e.exDate;
    m.set(e.symbol, cur);
  }
  _stats = m;
  return m;
}

function toRelated(c: Company, stats: Map<string, SymbolStats>): RelatedCompany {
  const s = stats.get(c.symbol) ?? { ttm: 0, events: 0, lastEx: null };
  const price = getPrice(c.symbol);
  return {
    symbol: c.symbol,
    name: c.name,
    industry: c.industry ?? null,
    sector: c.sector ?? null,
    ttmAmount: s.ttm,
    eventCount: s.events,
    currentYield: computeCurrentYield(s.ttm, price),
  };
}

// Active-payer filter: must have paid something in the last 12 months. Skips
// delisted / dormant tickers that would otherwise pollute the list.
function isActivePayer(s: SymbolStats | undefined, recentCutoff: string): boolean {
  if (!s || s.events === 0) return false;
  if (!s.lastEx || s.lastEx < recentCutoff) return false;
  return s.ttm > 0;
}

function recentCutoffIso(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Sector peers ranked by TTM payout, then event count. Falls back to same
 * industry when the sector has too few active peers to fill `limit`.
 */
export function getRelatedCompanies(symbol: string, limit = 6): RelatedCompany[] {
  const current = COMPANIES.find((c) => c.symbol === symbol);
  if (!current) return [];
  const stats = buildStats();
  const cutoff = recentCutoffIso();

  const score = (c: Company): number => {
    const s = stats.get(c.symbol);
    if (!isActivePayer(s, cutoff)) return -1;
    return s!.ttm * 1000 + s!.events;
  };
  const pick = (pool: Company[]): Company[] =>
    pool.filter((c) => score(c) > 0).sort((a, b) => score(b) - score(a));

  const sectorPool = current.sector
    ? pick(COMPANIES.filter((c) => c.symbol !== symbol && c.sector === current.sector))
    : [];
  const industryPool = current.industry
    ? pick(
        COMPANIES.filter(
          (c) =>
            c.symbol !== symbol &&
            c.industry === current.industry &&
            c.sector !== current.sector,
        ),
      )
    : [];

  const seen = new Set<string>();
  const chosen: Company[] = [];
  for (const c of [...sectorPool, ...industryPool]) {
    if (seen.has(c.symbol) || chosen.length >= limit) continue;
    seen.add(c.symbol);
    chosen.push(c);
  }
  return chosen.map((c) => toRelated(c, stats));
}

/**
 * Site-wide top dividend payers (by trailing-12-month amount) for the footer
 * "browse other companies" block.
 */
export function getPopularCompanies(excludeSymbol: string, limit = 8): RelatedCompany[] {
  const stats = buildStats();
  const cutoff = recentCutoffIso();
  const candidates = COMPANIES.filter((c) => {
    if (c.symbol === excludeSymbol) return false;
    return isActivePayer(stats.get(c.symbol), cutoff);
  });
  candidates.sort((a, b) => {
    const sa = stats.get(a.symbol)!;
    const sb = stats.get(b.symbol)!;
    return sb.ttm - sa.ttm || sb.events - sa.events;
  });
  return candidates.slice(0, limit).map((c) => toRelated(c, stats));
}
