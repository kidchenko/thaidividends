import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type BrowserContext, type Page } from "patchright";

// Date range to fetch. Past covered for "what already paid"; future covered so
// announced dividends show up in the calendar before they happen.
const START = { year: 2016, month: 1 };
const END = (() => {
  const now = new Date();
  const horizon = new Date(now);
  horizon.setUTCMonth(horizon.getUTCMonth() + 12);
  return { year: horizon.getUTCFullYear(), month: horizon.getUTCMonth() + 1 };
})();

const PAGE_URL = "https://www.set.or.th/en/market/stock-calendar/x-calendar";
const NAV_TIMEOUT_MS = 45_000;
const RESPONSE_WAIT_MS = 30_000;
const DELAY_BETWEEN_MONTHS_MS = 600;

type RawCorporateAction = {
  currency: string;
  symbol: string;
  name: string;
  caType: string;
  type: string;
  bookCloseDate: string | null;
  recordDate: string | null;
  remark: string | null;
  paymentDate: string | null;
  beginOperation: string | null;
  endOperation: string | null;
  sourceOfDividend: string | null;
  dividend: number | null;
  ratio: string | null;
  dividendType: string | null;
  approximatePaymentDate: string | null;
  tentativeDividendFlag: string | null;
  tentativeDividend: string | null;
  dividendPayment: string | null;
  xdate: string | null;
  xSession: string | null;
};

type DividendEvent = {
  symbol: string;
  name: string;
  exDate: string;          // YYYY-MM-DD
  recordDate: string | null;
  paymentDate: string | null;
  amount: number | null;
  currency: string;        // "Baht"
  dividendType: string;    // "Cash Dividend"
  caType: string;          // "XD" | "XD(ST)"
  sourceOfDividend: string | null;
  operationStart: string | null;
  operationEnd: string | null;
  tentative: boolean;
  remark: string | null;
};

type Company = {
  symbol: string;
  name: string;
  currency: string;
};

function ymKey(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function nextMonth(y: number, m: number): { year: number; month: number } {
  return m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
}

function isoDate(stamp: string | null): string | null {
  if (!stamp) return null;
  // SET returns "2026-05-20T00:00:00+07:00" — extract the calendar date.
  const m = stamp.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function toAmount(raw: RawCorporateAction): number | null {
  if (typeof raw.dividend === "number") return raw.dividend;
  if (raw.tentativeDividend) {
    const n = Number(raw.tentativeDividend);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Recursively pull every corporateActions array from the response.
function flattenActions(payload: unknown): RawCorporateAction[] {
  const out: RawCorporateAction[] = [];
  function walk(x: unknown) {
    if (Array.isArray(x)) {
      for (const i of x) walk(i);
    } else if (x && typeof x === "object") {
      const obj = x as Record<string, unknown>;
      const ca = obj.corporateActions;
      if (Array.isArray(ca)) {
        for (const e of ca) {
          if (e && typeof e === "object" && "symbol" in e) {
            out.push(e as RawCorporateAction);
          }
        }
      }
      for (const v of Object.values(obj)) walk(v);
    }
  }
  walk(payload);
  return out;
}

function normalize(raw: RawCorporateAction): DividendEvent | null {
  // Only XD / XD(ST) — Cash Dividend events.
  if (!raw.caType?.startsWith("XD")) return null;
  const exDate = isoDate(raw.xdate);
  if (!exDate) return null;
  return {
    symbol: raw.symbol,
    name: raw.name,
    exDate,
    recordDate: isoDate(raw.recordDate),
    paymentDate: isoDate(raw.paymentDate),
    amount: toAmount(raw),
    currency: raw.currency || "Baht",
    dividendType: raw.dividendType || "Cash Dividend",
    caType: raw.caType,
    sourceOfDividend: raw.sourceOfDividend,
    operationStart: isoDate(raw.beginOperation),
    operationEnd: isoDate(raw.endOperation),
    tentative: raw.tentativeDividendFlag === "A" || raw.dividend === null,
    remark: raw.remark,
  };
}

// Bootstrap the browser context once (passes Incapsula challenge, sets cookies),
// then we can call the SET API directly from inside the page for any month.
async function bootstrapPage(page: Page): Promise<void> {
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes("/api/set/stock-calendar/") && r.status() === 200,
    { timeout: RESPONSE_WAIT_MS },
  );
  await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  await responsePromise; // ensure the SPA's first call succeeded → cookies live
}

async function fetchMonth(page: Page, year: number, month: number): Promise<DividendEvent[]> {
  const url = `/api/set/stock-calendar/${year}/${month}/x-calendar?lang=en`;
  const payload = await page.evaluate(async (u) => {
    const res = await fetch(u, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, url);
  const raws = flattenActions(payload);
  return raws.map(normalize).filter((e): e is DividendEvent => e !== null);
}

async function main() {
  await mkdir("data", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    timezoneId: "Asia/Bangkok",
  });
  const page = await ctx.newPage();

  console.log("Bootstrapping browser context (passes Incapsula challenge)...");
  await bootstrapPage(page);
  console.log("Bootstrap OK; calling API directly for each month.\n");

  const all: DividendEvent[] = [];
  const failures: Array<{ key: string; error: string }> = [];

  let cursor = { year: START.year, month: START.month };
  const totalMonths =
    (END.year - START.year) * 12 + (END.month - START.month) + 1;
  let i = 0;

  while (true) {
    const key = ymKey(cursor.year, cursor.month);
    i++;
    process.stdout.write(`  [${String(i).padStart(2)}/${totalMonths}] ${key} ... `);
    try {
      const events = await fetchMonth(page, cursor.year, cursor.month);
      console.log(`${events.length} XD events`);
      all.push(...events);
    } catch (err) {
      const msg = (err as Error).message;
      console.log(`FAIL — ${msg}`);
      failures.push({ key, error: msg });
    }
    if (cursor.year === END.year && cursor.month === END.month) break;
    cursor = nextMonth(cursor.year, cursor.month);
    await sleep(DELAY_BETWEEN_MONTHS_MS);
  }

  await browser.close();

  // Dedupe (Y/M boundaries can occasionally repeat) by (symbol, exDate, caType).
  const seen = new Set<string>();
  const deduped: DividendEvent[] = [];
  for (const e of all) {
    const k = `${e.symbol}|${e.exDate}|${e.caType}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(e);
  }
  deduped.sort(
    (a, b) => a.exDate.localeCompare(b.exDate) || a.symbol.localeCompare(b.symbol),
  );

  // Build a companies lookup from the events themselves.
  const companyMap = new Map<string, Company>();
  for (const e of deduped) {
    if (!companyMap.has(e.symbol)) {
      companyMap.set(e.symbol, { symbol: e.symbol, name: e.name, currency: e.currency });
    }
  }
  const companies = [...companyMap.values()].sort((a, b) =>
    a.symbol.localeCompare(b.symbol),
  );

  await writeFile("data/set-dividends.json", JSON.stringify(deduped, null, 2));
  await writeFile("data/companies.json", JSON.stringify(companies, null, 2));

  const byYear = deduped.reduce<Record<string, number>>((acc, e) => {
    const y = e.exDate.slice(0, 4);
    acc[y] = (acc[y] ?? 0) + 1;
    return acc;
  }, {});

  console.log();
  console.log(`Months fetched:        ${totalMonths - failures.length}/${totalMonths}`);
  console.log(`Failures:              ${failures.length}`);
  console.log(`Total XD events:       ${deduped.length}`);
  console.log(`Unique tickers:        ${companies.length}`);
  console.log(`With payment date:     ${deduped.filter((e) => e.paymentDate).length}`);
  console.log(`Tentative amounts:     ${deduped.filter((e) => e.tentative).length}`);
  for (const [y, n] of Object.entries(byYear).sort()) {
    console.log(`  ${y}: ${n}`);
  }
  console.log();
  console.log("Wrote → data/set-dividends.json");
  console.log("Wrote → data/companies.json");
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});
