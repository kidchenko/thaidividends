import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type BrowserContext, type Page } from "patchright";

const ARGS = process.argv.slice(2);
const FULL_BACKFILL = ARGS.includes("--full");

// Incremental window: past slack catches late tentative→confirmed updates;
// future slack covers what companies have announced ahead.
const PAST_LOOKBACK_MONTHS = 2;
const FUTURE_LOOKAHEAD_MONTHS = 6;
const FULL_BACKFILL_START = { year: 2016, month: 1 };
const FULL_BACKFILL_FUTURE_HORIZON = 12;

const EXISTING_PATH = "data/set-dividends.json";

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

function shiftMonths(y: number, m: number, delta: number): { year: number; month: number } {
  const total = y * 12 + (m - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function compareYM(a: { year: number; month: number }, b: { year: number; month: number }): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

function eventKey(e: DividendEvent): string {
  return `${e.symbol}|${e.exDate}|${e.caType}`;
}

function eventsEqual(a: DividendEvent, b: DividendEvent): boolean {
  return (
    a.name === b.name &&
    a.exDate === b.exDate &&
    a.recordDate === b.recordDate &&
    a.paymentDate === b.paymentDate &&
    a.amount === b.amount &&
    a.currency === b.currency &&
    a.dividendType === b.dividendType &&
    a.caType === b.caType &&
    a.sourceOfDividend === b.sourceOfDividend &&
    a.operationStart === b.operationStart &&
    a.operationEnd === b.operationEnd &&
    a.tentative === b.tentative &&
    a.remark === b.remark
  );
}

async function loadExisting(): Promise<DividendEvent[] | null> {
  try {
    const raw = await readFile(EXISTING_PATH, "utf8");
    return JSON.parse(raw) as DividendEvent[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function computeWindow(
  existing: DividendEvent[],
): { start: { year: number; month: number }; end: { year: number; month: number } } {
  const now = new Date();
  const nowYM = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const start = shiftMonths(nowYM.year, nowYM.month, -PAST_LOOKBACK_MONTHS);
  const futureFloor = shiftMonths(nowYM.year, nowYM.month, FUTURE_LOOKAHEAD_MONTHS);
  const todayIso = `${nowYM.year}-${String(nowYM.month).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  let endCandidate = futureFloor;
  for (const e of existing) {
    if (e.exDate < todayIso) continue;
    const [y, m] = e.exDate.split("-").map(Number);
    const evtPlus1 = shiftMonths(y, m, 1);
    if (compareYM(evtPlus1, endCandidate) > 0) endCandidate = evtPlus1;
  }
  return { start, end: endCandidate };
}

async function main() {
  await mkdir("data", { recursive: true });

  const existing = await loadExisting();
  let start: { year: number; month: number };
  let end: { year: number; month: number };

  if (FULL_BACKFILL) {
    start = FULL_BACKFILL_START;
    const now = new Date();
    end = shiftMonths(now.getFullYear(), now.getMonth() + 1, FULL_BACKFILL_FUTURE_HORIZON);
    console.log(`Mode: FULL backfill — fetching ${ymKey(start.year, start.month)} → ${ymKey(end.year, end.month)}`);
  } else {
    if (!existing) {
      console.error(
        `No existing ${EXISTING_PATH} found. Run with --full to backfill from ${FULL_BACKFILL_START.year}.`,
      );
      process.exit(1);
    }
    ({ start, end } = computeWindow(existing));
    console.log(
      `Mode: incremental — fetching ${ymKey(start.year, start.month)} → ${ymKey(end.year, end.month)} (existing: ${existing.length} events)`,
    );
  }

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

  const fetched: DividendEvent[] = [];
  const successfulMonths = new Set<string>();
  const failures: Array<{ key: string; error: string }> = [];

  let cursor = { year: start.year, month: start.month };
  const totalMonths =
    (end.year - start.year) * 12 + (end.month - start.month) + 1;
  let i = 0;

  while (true) {
    const key = ymKey(cursor.year, cursor.month);
    i++;
    process.stdout.write(`  [${String(i).padStart(2)}/${totalMonths}] ${key} ... `);
    try {
      const events = await fetchMonth(page, cursor.year, cursor.month);
      console.log(`${events.length} XD events`);
      fetched.push(...events);
      successfulMonths.add(key);
    } catch (err) {
      const msg = (err as Error).message;
      console.log(`FAIL — ${msg}`);
      failures.push({ key, error: msg });
    }
    if (cursor.year === end.year && cursor.month === end.month) break;
    cursor = nextMonth(cursor.year, cursor.month);
    await sleep(DELAY_BETWEEN_MONTHS_MS);
  }

  await browser.close();

  // Merge: keep existing events untouched outside successful months;
  // for months that fetched successfully, replace with fresh data.
  const baseline = FULL_BACKFILL ? [] : (existing ?? []);
  const kept = baseline.filter((e) => !successfulMonths.has(e.exDate.slice(0, 7)));
  const merged = [...kept, ...fetched];

  // Dedupe by (symbol, exDate, caType) — fresh wins over kept on collision
  // (defensive; shouldn't happen given the filter above).
  const byKey = new Map<string, DividendEvent>();
  for (const e of merged) byKey.set(eventKey(e), e);
  const deduped = [...byKey.values()].sort(
    (a, b) => a.exDate.localeCompare(b.exDate) || a.symbol.localeCompare(b.symbol),
  );

  // Diff vs existing for the run summary.
  const existingByKey = new Map<string, DividendEvent>(
    (existing ?? []).map((e) => [eventKey(e), e]),
  );
  let added = 0;
  let updated = 0;
  for (const e of deduped) {
    const prev = existingByKey.get(eventKey(e));
    if (!prev) added++;
    else if (!eventsEqual(prev, e)) updated++;
  }
  const newKeys = new Set(deduped.map(eventKey));
  let removed = 0;
  for (const k of existingByKey.keys()) if (!newKeys.has(k)) removed++;

  // Build a companies lookup from the merged events.
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

  console.log();
  console.log(`Months fetched:        ${successfulMonths.size}/${totalMonths}`);
  console.log(`Failures:              ${failures.length}`);
  console.log(`Diff vs existing:      +${added} added · ~${updated} updated · -${removed} removed`);
  console.log(`Total XD events:       ${deduped.length}`);
  console.log(`Unique tickers:        ${companies.length}`);
  console.log(`With payment date:     ${deduped.filter((e) => e.paymentDate).length}`);
  console.log(`Tentative amounts:     ${deduped.filter((e) => e.tentative).length}`);
  console.log();
  console.log("Wrote → data/set-dividends.json");
  console.log("Wrote → data/companies.json");

  if (failures.length > 0) {
    console.log();
    console.log("Failed months (existing data preserved for these):");
    for (const f of failures) console.log(`  ${f.key}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});
