import fundamentalsData from "../../data/fundamentals.json";
import { getSetAnnualByYear } from "./set-stats";

export type AnnualIncome = {
  fiscalYearEnd: string;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  ebitda: number | null;
  eps: number | null;
};

export type AnnualCashflow = {
  fiscalYearEnd: string;
  operatingCashflow: number | null;
  capex: number | null;
  freeCashflow: number | null;
  dividendsPaid: number | null;
};

export type QuarterlyIncome = {
  quarterEnd: string;
  revenue: number | null;
  netIncome: number | null;
  eps: number | null;
};

export type QuarterlyCashflow = {
  quarterEnd: string;
  operatingCashflow: number | null;
  capex: number | null;
  freeCashflow: number | null;
  dividendsPaid: number | null;
};

export type PriceSnapshot = {
  date: string;
  close: number;
};

export type StockSplit = {
  date: string;
  numerator: number;
  denominator: number;
};

export type CompanyProfile = {
  description: string | null;
  website: string | null;
  fullTimeEmployees: number | null;
  yahooIndustry: string | null;
  yahooSector: string | null;
};

export type Fundamentals = {
  symbol: string;
  asOf: string;
  payoutRatio: number | null;
  debtToEquity: number | null;
  sharesOutstanding: number | null;
  incomeAnnual: AnnualIncome[];
  cashflowAnnual: AnnualCashflow[];
  quarterlyIncome?: QuarterlyIncome[];
  quarterlyCashflow?: QuarterlyCashflow[];
  priceQuarterEnds?: PriceSnapshot[];
  splits?: StockSplit[];
  profile?: CompanyProfile;
};

const FUNDAMENTALS = fundamentalsData as unknown as Record<string, Fundamentals>;

export function getFundamentals(symbol: string): Fundamentals | null {
  return FUNDAMENTALS[symbol] ?? null;
}

export type DividendQuality = {
  payoutRatio: number | null;
  fcfCoverage: number | null;
  fcfCoverageYear: string | null;
  debtToEquity: number | null;     // typically reported as a percentage by Yahoo
  trailingEps: number | null;
  epsHistory: Array<{ year: number; eps: number }>;
};

export type EarningsDividendsRow = {
  period: string;            // "2024" or "Q3 2024"
  date: string;              // period-end YYYY-MM-DD
  year: number;
  quarter?: number;
  netIncome: number;
  dividendsPaid: number;     // magnitude
  payoutRatio: number;
};

export type EarningsDividendsData = {
  annual: EarningsDividendsRow[];
  quarterly: EarningsDividendsRow[];
};

export type RevenueProfitRow = {
  period: string;            // "2024" or "Q3 2024"
  date: string;
  year: number;
  quarter?: number;
  revenue: number;
  netIncome: number;
  netMargin: number;
};

export type RevenueProfitData = {
  annual: RevenueProfitRow[];
  quarterly: RevenueProfitRow[];
};

export function getDividendQuality(symbol: string): DividendQuality | null {
  const f = getFundamentals(symbol);
  if (!f) return null;

  const cfRow = f.cashflowAnnual.find(
    (r) =>
      r.freeCashflow !== null &&
      r.dividendsPaid !== null &&
      r.dividendsPaid !== 0,
  );
  const fcfCoverage =
    cfRow && cfRow.freeCashflow !== null && cfRow.dividendsPaid !== null
      ? cfRow.freeCashflow / Math.abs(cfRow.dividendsPaid)
      : null;

  const epsHistory = f.incomeAnnual
    .filter((r) => r.eps !== null && r.fiscalYearEnd)
    .map((r) => ({ year: Number(r.fiscalYearEnd.slice(0, 4)), eps: r.eps! }))
    .sort((a, b) => a.year - b.year);

  const trailingEps = f.incomeAnnual[0]?.eps ?? null;

  return {
    payoutRatio: f.payoutRatio,
    fcfCoverage,
    fcfCoverageYear: cfRow?.fiscalYearEnd ?? null,
    debtToEquity: f.debtToEquity,
    trailingEps,
    epsHistory,
  };
}

/**
 * Annual + quarterly join of net income and dividends paid. Excludes periods
 * with non-positive net income (payout ratio breaks down for losses) and
 * periods where dividendsPaid is null. Sorted oldest-first.
 */
export function getEarningsVsDividends(symbol: string): EarningsDividendsData {
  const f = getFundamentals(symbol);
  if (!f) return { annual: [], quarterly: [] };

  const annualIncome = new Map<number, number>();
  for (const r of f.incomeAnnual) {
    if (r.netIncome === null || !r.fiscalYearEnd) continue;
    annualIncome.set(Number(r.fiscalYearEnd.slice(0, 4)), r.netIncome);
  }
  const annual: EarningsDividendsRow[] = [];
  for (const r of f.cashflowAnnual) {
    if (r.dividendsPaid === null || !r.fiscalYearEnd) continue;
    const year = Number(r.fiscalYearEnd.slice(0, 4));
    const netIncome = annualIncome.get(year);
    if (netIncome === undefined || netIncome <= 0) continue;
    const div = Math.abs(r.dividendsPaid);
    annual.push({
      period: String(year),
      date: r.fiscalYearEnd,
      year,
      netIncome,
      dividendsPaid: div,
      payoutRatio: div / netIncome,
    });
  }
  annual.sort((a, b) => a.year - b.year);

  // Quarterly: include every quarter with positive net income, even if it
  // didn't pay a dividend (those just show 0 bottom — useful "earned this much
  // but didn't pay" context).
  const dividendsByQuarter = new Map<string, number>();
  for (const r of f.quarterlyCashflow ?? []) {
    if (!r.quarterEnd || r.dividendsPaid === null) continue;
    dividendsByQuarter.set(r.quarterEnd, Math.abs(r.dividendsPaid));
  }
  const quarterly: EarningsDividendsRow[] = [];
  for (const r of f.quarterlyIncome ?? []) {
    if (r.netIncome === null || !r.quarterEnd || r.netIncome <= 0) continue;
    const year = Number(r.quarterEnd.slice(0, 4));
    const month = Number(r.quarterEnd.slice(5, 7));
    const quarter = Math.ceil(month / 3);
    const div = dividendsByQuarter.get(r.quarterEnd) ?? 0;
    quarterly.push({
      period: `Q${quarter} ${year}`,
      date: r.quarterEnd,
      year,
      quarter,
      netIncome: r.netIncome,
      dividendsPaid: div,
      payoutRatio: div / r.netIncome,
    });
  }
  quarterly.sort((a, b) => a.date.localeCompare(b.date));

  return { annual, quarterly };
}

/**
 * Annual + quarterly revenue and net income. Includes loss periods so the
 * data is honest — chart code clamps the filled portion to 0 visually but
 * reports real margin in the label.
 */
export function getRevenueProfit(symbol: string): RevenueProfitData {
  const f = getFundamentals(symbol);
  if (!f) return { annual: [], quarterly: [] };

  const annual: RevenueProfitRow[] = [];
  for (const r of f.incomeAnnual) {
    if (r.revenue === null || r.revenue <= 0) continue;
    if (r.netIncome === null) continue;
    if (!r.fiscalYearEnd) continue;
    const year = Number(r.fiscalYearEnd.slice(0, 4));
    annual.push({
      period: String(year),
      date: r.fiscalYearEnd,
      year,
      revenue: r.revenue,
      netIncome: r.netIncome,
      netMargin: r.netIncome / r.revenue,
    });
  }
  annual.sort((a, b) => a.year - b.year);

  const quarterly: RevenueProfitRow[] = [];
  for (const r of f.quarterlyIncome ?? []) {
    if (r.revenue === null || r.revenue <= 0) continue;
    if (r.netIncome === null) continue;
    if (!r.quarterEnd) continue;
    const year = Number(r.quarterEnd.slice(0, 4));
    const month = Number(r.quarterEnd.slice(5, 7));
    const quarter = Math.ceil(month / 3);
    quarterly.push({
      period: `Q${quarter} ${year}`,
      date: r.quarterEnd,
      year,
      quarter,
      revenue: r.revenue,
      netIncome: r.netIncome,
      netMargin: r.netIncome / r.revenue,
    });
  }
  quarterly.sort((a, b) => a.date.localeCompare(b.date));

  return { annual, quarterly };
}

export type EpsPoint = {
  date: string;             // YYYY-MM-DD (period end)
  year: number;
  quarter?: number;         // 1-4 for quarterly points; undefined for annual
  label: string;            // pretty label (e.g. "2024", "Q3 2024")
  eps: number;
};

export type EpsHistory = {
  quarterly: EpsPoint[];    // oldest-first
  annual: EpsPoint[];       // oldest-first
};

/**
 * Annual + quarterly EPS history. Quarterly comes from Yahoo's quarterly
 * fundamentalsTimeSeries; gaps (e.g. Q4 with no EPS pending year-end audit)
 * are dropped. Both arrays sorted oldest-first for chart rendering.
 */
export function getEpsHistory(symbol: string): EpsHistory {
  const f = getFundamentals(symbol);
  if (!f) return { quarterly: [], annual: [] };

  const annual: EpsPoint[] = f.incomeAnnual
    .filter((r) => r.eps !== null && r.fiscalYearEnd)
    .map((r) => {
      const year = Number(r.fiscalYearEnd.slice(0, 4));
      return { date: r.fiscalYearEnd, year, label: String(year), eps: r.eps! };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const quarterly: EpsPoint[] = (f.quarterlyIncome ?? [])
    .filter((r) => r.eps !== null && r.quarterEnd)
    .map((r) => {
      const year = Number(r.quarterEnd.slice(0, 4));
      const month = Number(r.quarterEnd.slice(5, 7));
      const quarter = Math.ceil(month / 3);
      return {
        date: r.quarterEnd,
        year,
        quarter,
        label: `Q${quarter} ${year}`,
        eps: r.eps!,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return { quarterly, annual };
}

export type EpsDpsRow = {
  year: number;
  eps: number | null;
  dps: number;            // dividend per share (sum of confirmed amounts in that ex-date year)
  payoutPerShare: number | null;  // dps / eps (only when eps > 0)
};

/**
 * Per-year EPS vs DPS. EPS comes from incomeAnnual, DPS is the sum of
 * confirmed dividend amounts (per share — that's how SET reports them) by
 * ex-date year. Returns rows for any year that has at least one of the two.
 */
export function getEpsVsDps(
  symbol: string,
  events: Array<{ exDate: string; amount: number | null }>,
): EpsDpsRow[] {
  const f = getFundamentals(symbol);
  const epsByYear = new Map<number, number>();
  if (f) {
    for (const r of f.incomeAnnual) {
      if (r.eps !== null && r.fiscalYearEnd) {
        epsByYear.set(Number(r.fiscalYearEnd.slice(0, 4)), r.eps);
      }
    }
  }
  const dpsByYear = new Map<number, number>();
  for (const e of events) {
    if (typeof e.amount !== "number" || !e.exDate) continue;
    const year = Number(e.exDate.slice(0, 4));
    dpsByYear.set(year, (dpsByYear.get(year) ?? 0) + e.amount);
  }

  const years = new Set<number>([...epsByYear.keys(), ...dpsByYear.keys()]);
  const rows: EpsDpsRow[] = [];
  for (const year of years) {
    const eps = epsByYear.get(year) ?? null;
    const dps = dpsByYear.get(year) ?? 0;
    rows.push({
      year,
      eps,
      dps,
      payoutPerShare: eps !== null && eps > 0 ? dps / eps : null,
    });
  }
  return rows.sort((a, b) => a.year - b.year).slice(-6);  // last 6 years max
}

export type ValuationRow = {
  period: string;          // "2024" or "Q3 2024"
  date: string;            // YYYY-MM-DD
  year: number;
  quarter?: number;
  close: number;
  eps: number | null;      // annual EPS or TTM EPS
  dps: number;             // annual DPS or TTM DPS
  pe: number | null;       // close / eps when eps > 0 (SET official when available for annual)
  yld: number;             // dps / close (SET official when available for annual)
  payoutRatio: number | null; // SET-reported annual payout ratio when available
  source: "yahoo" | "set";    // origin of pe/yld for this row
};

export type ValuationHistory = {
  annual: ValuationRow[];
  quarterly: ValuationRow[];
};

/**
 * Per-period valuation history. For each period:
 *  - annual: year-end close ÷ annual EPS (P/E), annual DPS ÷ year-end close (yield)
 *  - quarterly: quarter-end close ÷ TTM EPS (sum of last 4Q basicEPS),
 *               TTM DPS (sum of confirmed amounts in 12 months ending at the
 *               quarter-end) ÷ quarter-end close.
 *
 * "Historical only" by design — these numbers don't change once the period
 * closes, so they're safe to bake into a static build.
 */
export function getValuationHistory(
  symbol: string,
  events: Array<{ exDate: string; amount: number | null }>,
): ValuationHistory {
  const f = getFundamentals(symbol);
  if (!f || !f.priceQuarterEnds || f.priceQuarterEnds.length === 0) {
    return { annual: [], quarterly: [] };
  }

  // ---------- Annual ----------
  // Cumulative split factor for a dividend whose ex-date is BEFORE the splits.
  // Yahoo's `close` is split-adjusted; SET dividend amounts are recorded
  // as-paid at the time. Pre-split amounts must be divided by this factor.
  const splits = (f.splits ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const splitFactorAfter = (dateIso: string): number => {
    let factor = 1;
    for (const s of splits) {
      if (s.date > dateIso) factor *= s.numerator / s.denominator;
    }
    return factor;
  };
  const adjustedAmount = (e: { exDate: string; amount: number | null }): number | null => {
    if (typeof e.amount !== "number" || !e.exDate) return null;
    return e.amount / splitFactorAfter(e.exDate);
  };

  const epsByYear = new Map<number, number>();
  for (const r of f.incomeAnnual) {
    if (r.eps !== null && r.fiscalYearEnd) {
      // EPS from Yahoo is also split-adjusted historically — no adjustment needed.
      epsByYear.set(Number(r.fiscalYearEnd.slice(0, 4)), r.eps);
    }
  }
  const dpsByYear = new Map<number, number>();
  for (const e of events) {
    const adj = adjustedAmount(e);
    if (adj === null) continue;
    const y = Number(e.exDate.slice(0, 4));
    dpsByYear.set(y, (dpsByYear.get(y) ?? 0) + adj);
  }
  // SET trading-stat overlay — official year-end PE / yield / payout ratio for
  // the last few fiscal years. Where present we trust SET over our computed
  // values (it uses the published EPS that may differ from Yahoo's reporting).
  const setByYear = getSetAnnualByYear(symbol);
  const yearEnds = f.priceQuarterEnds
    .filter((p) => p.date.endsWith("-12-31"))
    .sort((a, b) => a.date.localeCompare(b.date));
  const annual: ValuationRow[] = yearEnds.map((p) => {
    const year = Number(p.date.slice(0, 4));
    const eps = epsByYear.get(year) ?? null;
    const dps = dpsByYear.get(year) ?? 0;
    const computedPe = eps !== null && eps > 0 ? p.close / eps : null;
    const computedYld = p.close > 0 ? dps / p.close : 0;
    const setRow = setByYear.get(year);
    const useSet = setRow && (setRow.pe !== null || setRow.dividendYield !== null);
    return {
      period: String(year),
      date: p.date,
      year,
      close: setRow?.close ?? p.close,
      eps,
      dps,
      pe: useSet ? (setRow!.pe ?? computedPe) : computedPe,
      yld: useSet && setRow!.dividendYield !== null
        ? setRow!.dividendYield / 100
        : computedYld,
      payoutRatio: setRow?.dividendPayoutRatio ?? null,
      source: useSet ? "set" : "yahoo",
    };
  });

  // ---------- Quarterly (TTM) ----------
  // Build sorted quarterly EPS list (oldest-first) for rolling sum.
  const sortedQEps = [...(f.quarterlyIncome ?? [])]
    .filter((r) => r.eps !== null && r.quarterEnd)
    .sort((a, b) => a.quarterEnd.localeCompare(b.quarterEnd));

  // Sum split-adjusted dividend events in (anchor - 12mo, anchor].
  const ttmDps = (anchorIso: string): number => {
    const anchor = new Date(anchorIso + "T00:00:00Z").getTime();
    const start = anchor - 365 * 86_400_000;
    let s = 0;
    for (const e of events) {
      const adj = adjustedAmount(e);
      if (adj === null) continue;
      const t = new Date(e.exDate + "T00:00:00Z").getTime();
      if (t > start && t <= anchor) s += adj;
    }
    return s;
  };
  const ttmEps = (anchorIso: string): number | null => {
    // Take 4 quarters whose quarterEnd ≤ anchor
    const upTo = sortedQEps.filter((q) => q.quarterEnd <= anchorIso);
    if (upTo.length < 4) return null;
    const last4 = upTo.slice(-4);
    let s = 0;
    for (const q of last4) {
      if (q.eps === null) return null;
      s += q.eps;
    }
    return s;
  };

  const sortedSnapshots = [...f.priceQuarterEnds].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const quarterly: ValuationRow[] = sortedSnapshots.map((p) => {
    const year = Number(p.date.slice(0, 4));
    const month = Number(p.date.slice(5, 7));
    const quarter = Math.ceil(month / 3);
    const eps = ttmEps(p.date);
    const dps = ttmDps(p.date);
    return {
      period: `Q${quarter} ${year}`,
      date: p.date,
      year,
      quarter,
      close: p.close,
      eps,
      dps,
      pe: eps !== null && eps > 0 ? p.close / eps : null,
      yld: p.close > 0 ? dps / p.close : 0,
      payoutRatio: null,
      source: "yahoo",
    };
  });

  return { annual, quarterly };
}

export function hasAnyQualityData(q: DividendQuality | null): boolean {
  if (!q) return false;
  return (
    q.payoutRatio !== null ||
    q.fcfCoverage !== null ||
    q.debtToEquity !== null ||
    q.epsHistory.length > 0
  );
}
