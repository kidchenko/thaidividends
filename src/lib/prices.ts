import pricesData from "../../data/prices.json";

export type PriceSnapshot = {
  close: number;
  change: number;
  changePercent: number;
  asOfDate: string;        // YYYY-MM-DD (when Yahoo last quoted it)
};

export type PriceData = {
  asOf: string | null;     // ISO timestamp of when the fetch ran
  prices: Record<string, PriceSnapshot>;
};

const PRICES = pricesData as unknown as PriceData;

export function getPrice(symbol: string): PriceSnapshot | null {
  return PRICES.prices?.[symbol] ?? null;
}

export function getPricesAsOf(): string | null {
  return PRICES.asOf;
}

/**
 * Trailing-12-month yield using the freshest close. Returns null if either
 * the price or the TTM amount is missing/zero.
 */
export function computeCurrentYield(
  ttmAmount: number,
  price: PriceSnapshot | null,
): number | null {
  if (!price || price.close <= 0 || ttmAmount <= 0) return null;
  return ttmAmount / price.close;
}

/**
 * Current P/E = today's price / TTM EPS. Returns null when either is missing
 * or when EPS is non-positive (P/E is undefined for losses).
 */
export function computeCurrentPE(
  ttmEps: number | null,
  price: PriceSnapshot | null,
): number | null {
  if (!price || price.close <= 0 || ttmEps === null || ttmEps <= 0) return null;
  return price.close / ttmEps;
}
