import type { APIRoute } from "astro";
import { getAllSymbols, getCompany, getEventsForSymbol, todayIso, type DividendEvent } from "./dividends";
import {
  getDividendQuality,
  getEpsHistory,
  getFundamentals,
  getRevenueProfit,
  getValuationHistory,
} from "./fundamentals";
import { computeCurrentPE, computeCurrentYield, getPrice } from "./prices";

// Compact field names: the manifest ships to every visitor to /compare/, so
// every byte counts. Numeric fields are kept raw - the client formats them.
export type CompareEntry = {
  s: string;                  // symbol
  n: string;                  // company name
  sec: string | null;         // sector code (e.g. "BANK")
  ind: string | null;         // industry code (e.g. "FINCIAL")
  price: number | null;       // latest close
  pe: number | null;          // current P/E
  yld: number | null;         // current TTM yield (decimal)
  pay: number | null;         // payout ratio (decimal)
  ttm: number | null;         // TTM dividend amount (baht)
  r12: number | null;         // 12-month price return (decimal)
  fcf: number | null;         // FCF coverage (multiple)
  de: number | null;          // debt / equity (percent, Yahoo convention)
  eps: number | null;         // EPS growth annualised (decimal)
  rev: number | null;         // revenue growth 3y CAGR (decimal)
  st: number | null;          // dividend streak (consecutive years paid)
};

export type CompareManifest = {
  generatedAt: string;        // YYYY-MM-DD
  entries: CompareEntry[];
};

function computeStreak(events: DividendEvent[]): number | null {
  const yearsPaid = new Set<number>();
  for (const e of events) {
    if (typeof e.amount === "number" && e.amount > 0) {
      yearsPaid.add(Number(e.exDate.slice(0, 4)));
    }
  }
  if (yearsPaid.size === 0) return null;
  const current = new Date().getFullYear();
  let y = yearsPaid.has(current) ? current : current - 1;
  let streak = 0;
  while (yearsPaid.has(y)) { streak++; y--; }
  return streak;
}

function buildEntry(symbol: string, today: string, cutoff: string): CompareEntry | null {
  const company = getCompany(symbol);
  if (!company) return null;
  const events = getEventsForSymbol(symbol);

  const fundamentals = getFundamentals(symbol);
  const quality = getDividendQuality(symbol);
  const epsHistory = getEpsHistory(symbol);
  const revenue = getRevenueProfit(symbol);
  const valuation = getValuationHistory(symbol, events);
  const priceSnapshot = getPrice(symbol);

  const ttmAmount = events.reduce(
    (sum, e) => (typeof e.amount === "number" && e.exDate >= cutoff && e.exDate <= today ? sum + e.amount : sum),
    0,
  );

  // Latest TTM EPS for P/E (mirror logic in [symbol].astro).
  const latestTtmEps = (() => {
    for (let i = valuation.quarterly.length - 1; i >= 0; i--) {
      const r = valuation.quarterly[i];
      if (r.eps !== null && r.eps > 0) return r.eps;
    }
    for (let i = valuation.annual.length - 1; i >= 0; i--) {
      const r = valuation.annual[i];
      if (r.eps !== null && r.eps > 0) return r.eps;
    }
    return null;
  })();

  const yld = computeCurrentYield(ttmAmount, priceSnapshot);
  const pe = computeCurrentPE(latestTtmEps, priceSnapshot);

  // Payout: prefer Yahoo TTM, fall back to most recent SET annual.
  const payout: number | null = (() => {
    const yh = fundamentals?.payoutRatio;
    if (typeof yh === "number") return yh;
    for (let i = valuation.annual.length - 1; i >= 0; i--) {
      const r = valuation.annual[i];
      if (r.payoutRatio !== null) return r.payoutRatio;
    }
    return null;
  })();

  // 12m return: closest quarter-end ~365 days back.
  let r12: number | null = null;
  if (priceSnapshot && fundamentals?.priceQuarterEnds && fundamentals.priceQuarterEnds.length > 0) {
    const todayMs = new Date(`${priceSnapshot.asOfDate}T00:00:00Z`).getTime();
    const yearAgoMs = todayMs - 365 * 86_400_000;
    let best: { date: string; close: number } | null = null;
    let bestDiff = Infinity;
    for (const p of fundamentals.priceQuarterEnds) {
      const diff = Math.abs(new Date(`${p.date}T00:00:00Z`).getTime() - yearAgoMs);
      if (diff < bestDiff) { bestDiff = diff; best = p; }
    }
    if (best && bestDiff <= 60 * 86_400_000 && best.close > 0) {
      r12 = (priceSnapshot.close - best.close) / best.close;
    }
  }

  // EPS growth annualised.
  let epsGrowth: number | null = null;
  if (epsHistory.annual.length >= 2) {
    const first = epsHistory.annual[0];
    const last = epsHistory.annual[epsHistory.annual.length - 1];
    if (first.eps > 0 && last.eps > 0 && last.year > first.year) {
      const span = last.year - first.year;
      epsGrowth = Math.pow(last.eps / first.eps, 1 / span) - 1;
    }
  }

  // Revenue 3y CAGR.
  let revGrowth: number | null = null;
  if (revenue.annual.length >= 4) {
    const latest = revenue.annual[revenue.annual.length - 1];
    const start = revenue.annual[revenue.annual.length - 4];
    if (start.revenue > 0 && latest.revenue > 0 && latest.year > start.year) {
      const span = latest.year - start.year;
      revGrowth = Math.pow(latest.revenue / start.revenue, 1 / span) - 1;
    }
  }

  return {
    s: symbol,
    n: company.name,
    sec: company.sector ?? null,
    ind: company.industry ?? null,
    price: priceSnapshot?.close ?? null,
    pe,
    yld,
    pay: payout,
    ttm: ttmAmount > 0 ? ttmAmount : null,
    r12,
    fcf: quality?.fcfCoverage ?? null,
    de: quality?.debtToEquity ?? null,
    eps: epsGrowth,
    rev: revGrowth,
    st: computeStreak(events),
  };
}

export function buildCompareManifest(): CompareManifest {
  const today = todayIso();
  const cutoff = (() => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const symbols = getAllSymbols();
  const entries: CompareEntry[] = [];
  for (const symbol of symbols) {
    const entry = buildEntry(symbol, today, cutoff);
    if (!entry) continue;
    // Skip rows with no metric at all - they pollute the picker with delisted
    // symbols. Sector/name alone aren't enough to compare on.
    const hasAnyMetric = [
      entry.pe, entry.yld, entry.pay, entry.ttm, entry.r12,
      entry.fcf, entry.de, entry.eps, entry.rev, entry.st,
    ].some((v) => v !== null);
    if (!hasAnyMetric) continue;
    entries.push(entry);
  }
  // Sort alphabetically for stable picker ordering.
  entries.sort((a, b) => a.s.localeCompare(b.s));
  return { generatedAt: today, entries };
}

export const compareManifestRoute: APIRoute = () => {
  const manifest = buildCompareManifest();
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/json" },
  });
};
