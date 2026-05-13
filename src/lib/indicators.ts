import { getDividendCAGR, type DividendEvent } from "./dividends";
import type { DividendQuality, EpsHistory, Fundamentals, RevenueProfitData, ValuationHistory } from "./fundamentals";
import type { PriceSnapshot } from "./prices";
import type { SectorStats } from "./sector-stats";
import { type Lang, t } from "./i18n";

export type IndicatorTone = "ok" | "neutral" | "warn" | "danger";

export type IndicatorHistoryPoint = {
  year: number;
  value: number;
  label: string;       // preformatted display value
};

export type IndicatorHistory = {
  series: IndicatorHistoryPoint[];   // oldest-first
  avg: number;
  avgLabel: string;
};

export type Indicator = {
  labelKey: string;          // i18n key for the tile label
  value: string;             // preformatted main value (e.g. "13.4×", "+12.5%")
  tone: IndicatorTone;
  detail?: string;           // optional preformatted secondary line ("5y avg 14.2×")
  history?: IndicatorHistory; // when present, tile becomes clickable → modal
};

const fmtPct = (n: number, dp = 1): string => `${(n * 100).toFixed(dp)}%`;
const fmtSignedPct = (n: number, dp = 1): string =>
  `${n >= 0 ? "+" : ""}${(n * 100).toFixed(dp)}%`;
const fmtMul = (n: number): string => `${n.toFixed(1)}×`;
const fmtCompactBaht = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T ฿`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B ฿`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M ฿`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K ฿`;
  return `${n.toFixed(0)} ฿`;
};

const avg = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length;

type Args = {
  events: DividendEvent[];
  valuation: ValuationHistory;
  fundamentals: Fundamentals | null;
  revenue: RevenueProfitData;
  quality: DividendQuality | null;
  epsHistory: EpsHistory;
  currentPE: number | null;
  currentYield: number | null;
  priceSnapshot: PriceSnapshot | null;
  sectorStats: SectorStats | null;
};

export function getStockIndicators(lang: Lang, args: Args): Indicator[] {
  const { events, valuation, fundamentals, revenue, quality, epsHistory, currentPE, currentYield, priceSnapshot, sectorStats } = args;
  const rows: Indicator[] = [];

  // 1. P/E vs 5y average. Cheap below 0.85×, expensive above 1.15× - the deadband
  // avoids flipping verdicts on small noise around the mean.
  const peRows = valuation.annual.filter((r) => r.pe !== null && r.pe > 0).slice(-5);
  const peValues = peRows.map((r) => r.pe!);
  const peAvg = avg(peValues);
  if (currentPE !== null && peAvg !== null) {
    const ratio = currentPE / peAvg;
    const tone: IndicatorTone = ratio < 0.85 ? "ok" : ratio < 1.15 ? "neutral" : "warn";
    // Detail line: 5y self-avg first (internal context), then sector median
    // (external context) when we have it. Sector pairs ratio scanners with the
    // peer-relative read at the same glance.
    const detailParts = [`${t(lang, "indVs5yAvg")} ${fmtMul(peAvg)}`];
    if (sectorStats?.peMedian) {
      detailParts.push(`${t(lang, "indVsSector")} ${fmtMul(sectorStats.peMedian)}`);
    }
    rows.push({
      labelKey: "indPe",
      value: fmtMul(currentPE),
      tone,
      detail: detailParts.join(" , "),
      history: peRows.length >= 2 ? {
        series: peRows.map((r) => ({ year: r.year, value: r.pe!, label: fmtMul(r.pe!) })),
        avg: peAvg,
        avgLabel: fmtMul(peAvg),
      } : undefined,
    });
  }

  // 2. Yield vs 5y average. Symmetric to P/E but flipped - high yield = ok.
  const yldRows = valuation.annual.filter((r) => r.yld > 0).slice(-5);
  const yldValues = yldRows.map((r) => r.yld);
  const yldAvg = avg(yldValues);
  if (currentYield !== null && yldAvg !== null && yldAvg > 0) {
    const ratio = currentYield / yldAvg;
    const tone: IndicatorTone = ratio > 1.15 ? "ok" : ratio > 0.85 ? "neutral" : "warn";
    const detailParts = [`${t(lang, "indVs5yAvg")} ${fmtPct(yldAvg, 2)}`];
    if (sectorStats?.yldMedian) {
      detailParts.push(`${t(lang, "indVsSector")} ${fmtPct(sectorStats.yldMedian, 2)}`);
    }
    rows.push({
      labelKey: "indYield",
      value: fmtPct(currentYield, 2),
      tone,
      detail: detailParts.join(" , "),
      history: yldRows.length >= 2 ? {
        series: yldRows.map((r) => ({ year: r.year, value: r.yld, label: fmtPct(r.yld, 2) })),
        avg: yldAvg,
        avgLabel: fmtPct(yldAvg, 2),
      } : undefined,
    });
  }

  // 3. Payout ratio. Prefer Yahoo's TTM (fundamentals.payoutRatio) since it's
  // freshest; fall back to most recent SET annual payoutRatio if absent.
  const latestPayout: number | null = (() => {
    const yahoo = fundamentals?.payoutRatio;
    if (typeof yahoo === "number") return yahoo;
    for (let i = valuation.annual.length - 1; i >= 0; i--) {
      const r = valuation.annual[i];
      if (r.payoutRatio !== null) return r.payoutRatio;
    }
    return null;
  })();
  if (latestPayout !== null) {
    const tone: IndicatorTone =
      latestPayout < 0.5 ? "ok"
      : latestPayout < 0.85 ? "neutral"
      : latestPayout < 1.0 ? "warn"
      : "danger";
    // Historical payout series comes from SET overlay (only some annual rows
    // carry a payoutRatio). Show the modal only when ≥2 years of history exist.
    const payoutRows = valuation.annual
      .filter((r) => r.payoutRatio !== null && r.payoutRatio > 0)
      .slice(-5);
    const payoutValues = payoutRows.map((r) => r.payoutRatio!);
    const payoutAvg = avg(payoutValues);
    // EPS-to-DPS coverage is the inverse of payout but easier to scan: "EPS
    // covers DPS 1.4×" is more intuitive than "70% payout" for "how much
    // headroom does the dividend have?"
    const coverage = latestPayout > 0 ? 1 / latestPayout : null;
    rows.push({
      labelKey: "indPayout",
      value: fmtPct(latestPayout, 0),
      tone,
      detail: coverage !== null
        ? `${t(lang, "indCoverageEps")} ${fmtMul(coverage)}`
        : undefined,
      history: payoutAvg !== null && payoutRows.length >= 2 ? {
        series: payoutRows.map((r) => ({
          year: r.year,
          value: r.payoutRatio!,
          label: fmtPct(r.payoutRatio!, 0),
        })),
        avg: payoutAvg,
        avgLabel: fmtPct(payoutAvg, 0),
      } : undefined,
    });
  }

  // 4. 12-month return - today's close vs the closest quarterly snapshot
  // ~365 days back; only emit if a snapshot lies within ±60 days of that mark.
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
      const ret = (priceSnapshot.close - best.close) / best.close;
      const tone: IndicatorTone = ret > 0.1 ? "ok" : ret > -0.1 ? "neutral" : "warn";
      rows.push({
        labelKey: "indReturn12m",
        value: fmtSignedPct(ret),
        tone,
      });
    }
  }

  // 4b. 3-year total return (annualised). Price + reinvested dividends over
  // the period, normalised to a per-year figure so it's directly comparable
  // to the 12-month return above. Only emits when we have a price snapshot
  // ~3 years back (within ±90 days) and a positive starting price.
  if (priceSnapshot && fundamentals?.priceQuarterEnds && fundamentals.priceQuarterEnds.length > 0) {
    const todayMs = new Date(`${priceSnapshot.asOfDate}T00:00:00Z`).getTime();
    const threeYearAgoMs = todayMs - 3 * 365 * 86_400_000;
    let best: { date: string; close: number } | null = null;
    let bestDiff = Infinity;
    for (const p of fundamentals.priceQuarterEnds) {
      const diff = Math.abs(new Date(`${p.date}T00:00:00Z`).getTime() - threeYearAgoMs);
      if (diff < bestDiff) { bestDiff = diff; best = p; }
    }
    if (best && bestDiff <= 90 * 86_400_000 && best.close > 0) {
      const startMs = new Date(`${best.date}T00:00:00Z`).getTime();
      const startIso = best.date;
      const todayIso = priceSnapshot.asOfDate;
      const divs = events.reduce(
        (s, e) => (typeof e.amount === "number" && e.exDate >= startIso && e.exDate <= todayIso ? s + e.amount : s),
        0,
      );
      const totalReturn = (priceSnapshot.close + divs - best.close) / best.close;
      const spanYears = (todayMs - startMs) / (365 * 86_400_000);
      if (spanYears > 0) {
        const annualised = Math.pow(1 + totalReturn, 1 / spanYears) - 1;
        const tone: IndicatorTone = annualised > 0.10 ? "ok" : annualised > 0 ? "neutral" : "warn";
        rows.push({
          labelKey: "indTotalReturn3y",
          value: fmtSignedPct(annualised),
          tone,
          detail: `${t(lang, "indTotalReturnSub")} ${fmtSignedPct(totalReturn)}`,
        });
      }
    }
  }

  // 5. FCF coverage - free cash flow ÷ dividends paid for the latest year on
  // record. ≥1.5× healthy, ≥1.0× tight, <1.0× under-covered (dividend isn't
  // earning itself, paid from balance sheet or debt).
  if (quality?.fcfCoverage !== null && quality?.fcfCoverage !== undefined) {
    const cov = quality.fcfCoverage;
    const tone: IndicatorTone = cov >= 1.5 ? "ok" : cov >= 1.0 ? "neutral" : "warn";
    rows.push({
      labelKey: "indFcfCoverage",
      value: fmtMul(cov),
      tone,
      detail: quality.fcfCoverageYear ? quality.fcfCoverageYear.slice(0, 4) : undefined,
    });
  }

  // 5b. Cash conversion - free cash flow ÷ net income, averaged over up to
  // 3 most recent years. Catches the "earnings on paper but no cash" pattern
  // earlier than FCF coverage alone (which can look fine when the dividend
  // itself is small). Healthy ≥ 0.8×; weak < 0.5×.
  if (fundamentals?.incomeAnnual && fundamentals.cashflowAnnual) {
    const incomeByYear = new Map<string, number>();
    for (const r of fundamentals.incomeAnnual) {
      if (r.netIncome !== null && r.fiscalYearEnd) {
        incomeByYear.set(r.fiscalYearEnd, r.netIncome);
      }
    }
    const ratios: Array<{ year: string; ratio: number }> = [];
    for (const r of fundamentals.cashflowAnnual) {
      if (r.freeCashflow === null || !r.fiscalYearEnd) continue;
      const ni = incomeByYear.get(r.fiscalYearEnd);
      if (ni === undefined || ni <= 0) continue;
      ratios.push({ year: r.fiscalYearEnd, ratio: r.freeCashflow / ni });
    }
    if (ratios.length >= 1) {
      ratios.sort((a, b) => b.year.localeCompare(a.year));
      const recent = ratios.slice(0, 3);
      const avgRatio = avg(recent.map((r) => r.ratio));
      if (avgRatio !== null) {
        const tone: IndicatorTone =
          avgRatio >= 0.8 ? "ok"
          : avgRatio >= 0.5 ? "neutral"
          : "warn";
        rows.push({
          labelKey: "indCashConversion",
          value: fmtMul(avgRatio),
          tone,
          detail: recent.length > 1 ? `${recent.length}y avg` : recent[0].year.slice(0, 4),
        });
      }
    }
  }

  // 6. Debt / equity. Yahoo reports as a percentage; <50% low, 50-100%
  // moderate, 100-200% elevated, >200% high. Useful sustainability signal:
  // a stretched balance sheet limits room to keep paying through a downturn.
  if (quality?.debtToEquity !== null && quality?.debtToEquity !== undefined) {
    const de = quality.debtToEquity;
    const tone: IndicatorTone =
      de < 50 ? "ok"
      : de < 100 ? "neutral"
      : de < 200 ? "warn"
      : "danger";
    rows.push({
      labelKey: "indDebtEquity",
      value: `${de.toFixed(0)}%`,
      tone,
    });
  }

  // 7. EPS growth (annualised over the available annual EPS span). Mirrors
  // revenue growth but at the per-share level so buy-backs / dilution show up.
  if (epsHistory.annual.length >= 2) {
    const first = epsHistory.annual[0];
    const last = epsHistory.annual[epsHistory.annual.length - 1];
    if (first.eps > 0 && last.eps > 0 && last.year > first.year) {
      const span = last.year - first.year;
      const rate = Math.pow(last.eps / first.eps, 1 / span) - 1;
      const tone: IndicatorTone = rate > 0.10 ? "ok" : rate > 0 ? "neutral" : "warn";
      const epsSeries = epsHistory.annual.slice(-5);
      const epsAvg = avg(epsSeries.map((p) => p.eps));
      rows.push({
        labelKey: "indEpsGrowth",
        value: fmtSignedPct(rate),
        tone,
        detail: `${first.year}-${last.year}`,
        history: epsAvg !== null && epsSeries.length >= 2 ? {
          series: epsSeries.map((p) => ({
            year: p.year,
            value: p.eps,
            label: `${p.eps.toFixed(2)} ฿`,
          })),
          avg: epsAvg,
          avgLabel: `${epsAvg.toFixed(2)} ฿`,
        } : undefined,
      });
    }
  }

  // 8. Revenue 3y CAGR. Needs at least 4 annual rows (year T-3 through T).
  if (revenue.annual.length >= 4) {
    const latest = revenue.annual[revenue.annual.length - 1];
    const start = revenue.annual[revenue.annual.length - 4];
    if (start.revenue > 0 && latest.revenue > 0 && latest.year > start.year) {
      const span = latest.year - start.year;
      const rate = Math.pow(latest.revenue / start.revenue, 1 / span) - 1;
      const tone: IndicatorTone = rate > 0.10 ? "ok" : rate > 0 ? "neutral" : "warn";
      // Modal shows the absolute revenue trail behind the CAGR - the average
      // value is meaningful too (helps judge whether the trend is rising or
      // just bouncing around a stable mean).
      const revRows = revenue.annual.slice(-5);
      const revValues = revRows.map((r) => r.revenue);
      const revAvg = avg(revValues);
      rows.push({
        labelKey: "indRevenueGrowth",
        value: fmtSignedPct(rate),
        tone,
        detail: `${start.year}-${latest.year}`,
        history: revAvg !== null && revRows.length >= 2 ? {
          series: revRows.map((r) => ({
            year: r.year,
            value: r.revenue,
            label: fmtCompactBaht(r.revenue),
          })),
          avg: revAvg,
          avgLabel: fmtCompactBaht(revAvg),
        } : undefined,
      });
    }
  }

  // 8b. Dividend growth CAGR. Annualised growth of total annual dividends
  // across the available window. Skips the current year (incomplete) inside
  // getDividendCAGR. Core DGI metric - distinguishes "stable payer" from
  // "growing payer."
  const divCagr = getDividendCAGR(events);
  if (divCagr !== null) {
    const tone: IndicatorTone = divCagr.rate > 0.05 ? "ok" : divCagr.rate > 0 ? "neutral" : "warn";
    rows.push({
      labelKey: "indDividendGrowth",
      value: fmtSignedPct(divCagr.rate),
      tone,
      detail: `${divCagr.startYear}-${divCagr.endYear}`,
    });
  }

  // 9. Dividend streak. Consecutive years (current year tolerated as "not yet")
  // with at least one paid dividend, counted backward from today.
  const streak = computeDividendStreak(events);
  if (streak !== null) {
    const tone: IndicatorTone = streak >= 5 ? "ok" : streak >= 2 ? "neutral" : "warn";
    const yearWord = t(lang, streak === 1 ? "yearOne" : "yearMany");
    rows.push({
      labelKey: "indDividendStreak",
      value: `${streak} ${yearWord}`,
      tone,
    });
  }

  return rows;
}

function computeDividendStreak(events: DividendEvent[]): number | null {
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
