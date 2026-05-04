import {
  addMonths as fnsAddMonths,
  eachDayOfInterval,
  endOfWeek,
  format,
  getDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { enUS, th as thLocale } from "date-fns/locale";

import dividends from "../../data/set-dividends.json";
import companiesData from "../../data/companies.json";
import { type Lang, DEFAULT_LANG, localePath } from "./i18n";

const locales: Record<Lang, Locale> = { en: enUS, th: thLocale };

export type DividendEvent = {
  symbol: string;
  name: string;
  exDate: string;                  // YYYY-MM-DD
  recordDate: string | null;
  paymentDate: string | null;
  amount: number | null;           // null when amount is unknown / pending
  currency: string;                // "Baht"
  dividendType: string;            // "Cash Dividend"
  caType: string;                  // "XD" | "XD(ST)"
  sourceOfDividend: string | null; // "Net Profit" | "Retained Earnings" | ...
  operationStart: string | null;
  operationEnd: string | null;
  tentative: boolean;              // SET marked as tentative or amount missing
  remark: string | null;
};

export type Company = {
  symbol: string;
  name: string;
  currency: string;
};

export type YearMonth = {
  year: number;
  month: number; // 1-12
  key: string;   // YYYY-MM
  label: string; // "May 2026"
  path: string;  // /2026/05/
};

const PAST_PADDING_MONTHS = 1;
const FUTURE_HORIZON_MONTHS = 12;

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

/** Prefix any absolute path with the configured site base. */
export function withBase(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${BASE}${p}`;
}

const COMPANY_BY_SYMBOL: Map<string, Company> = new Map(
  (companiesData as Company[]).map((c) => [c.symbol, c]),
);

export function getCompany(symbol: string): Company | null {
  return COMPANY_BY_SYMBOL.get(symbol) ?? null;
}

export function getCompanyName(symbol: string): string {
  return COMPANY_BY_SYMBOL.get(symbol)?.name ?? symbol;
}

export function loadEvents(): DividendEvent[] {
  return (dividends as DividendEvent[]).slice().sort(
    (a, b) => a.exDate.localeCompare(b.exDate) || a.symbol.localeCompare(b.symbol),
  );
}

export function getEventsForSymbol(symbol: string): DividendEvent[] {
  return (dividends as DividendEvent[])
    .filter((e) => e.symbol === symbol)
    .sort((a, b) => b.exDate.localeCompare(a.exDate)); // newest first
}

export function getAllSymbols(): string[] {
  return (companiesData as Company[]).map((c) => c.symbol);
}

export type SymbolStats = {
  count: number;
  firstDate: string | null;
  lastDate: string | null;
  totalAmount: number;       // sum of confirmed amounts
  confirmedCount: number;    // events with non-null amount
  upcoming: DividendEvent | null;  // next future event by ex-date
  lastPaid: DividendEvent | null;  // most recent past event
};

export function getSymbolStats(events: DividendEvent[], today: string = todayIso()): SymbolStats {
  if (events.length === 0) {
    return {
      count: 0, firstDate: null, lastDate: null,
      totalAmount: 0, confirmedCount: 0,
      upcoming: null, lastPaid: null,
    };
  }
  // events come newest-first
  const dates = events.map((e) => e.exDate);
  const lastDate = dates[0];
  const firstDate = dates[dates.length - 1];
  let totalAmount = 0;
  let confirmedCount = 0;
  for (const e of events) {
    if (typeof e.amount === "number") {
      totalAmount += e.amount;
      confirmedCount += 1;
    }
  }
  // Use payment date when available so a dividend whose ex-date passed but
  // whose cash hasn't been distributed yet still counts as upcoming.
  const effectiveDate = (e: DividendEvent): string => e.paymentDate ?? e.exDate;
  const future = events.filter((e) => effectiveDate(e) >= today);
  const upcoming = future.length > 0 ? future[future.length - 1] : null; // closest future
  const past = events.filter((e) => effectiveDate(e) < today);
  const lastPaid = past.length > 0 ? past[0] : null; // newest past (events sorted desc)
  return {
    count: events.length,
    firstDate, lastDate,
    totalAmount, confirmedCount,
    upcoming, lastPaid,
  };
}

export type CadenceCell = {
  year: number;
  month: number; // 1-12
  events: DividendEvent[];
  totalAmount: number; // sum of confirmed amounts in cell
};

export type Cadence = {
  years: number[];                       // chronological asc
  cells: Map<string, CadenceCell>;       // key `${year}-${month}`
  monthFrequency: number[];              // length 12: how many years had >=1 event
};

export function getCadence(events: DividendEvent[]): Cadence {
  if (events.length === 0) {
    return { years: [], cells: new Map(), monthFrequency: new Array(12).fill(0) };
  }
  const years = [...new Set(events.map((e) => Number(e.exDate.slice(0, 4))))].sort((a, b) => a - b);
  const cells = new Map<string, CadenceCell>();
  for (const e of events) {
    const y = Number(e.exDate.slice(0, 4));
    const m = Number(e.exDate.slice(5, 7));
    const key = `${y}-${m}`;
    const cell = cells.get(key) ?? { year: y, month: m, events: [], totalAmount: 0 };
    cell.events.push(e);
    if (typeof e.amount === "number") cell.totalAmount += e.amount;
    cells.set(key, cell);
  }
  // For each month 1..12, count distinct years with at least one event
  const monthFrequency = new Array(12).fill(0);
  for (let m = 1; m <= 12; m++) {
    const yearsWith = new Set<number>();
    for (const cell of cells.values()) {
      if (cell.month === m) yearsWith.add(cell.year);
    }
    monthFrequency[m - 1] = yearsWith.size;
  }
  return { years, cells, monthFrequency };
}

export function groupEventsByYear(events: DividendEvent[]): Array<{
  year: number;
  events: DividendEvent[];
}> {
  const map = new Map<number, DividendEvent[]>();
  for (const e of events) {
    const y = Number(e.exDate.slice(0, 4));
    const list = map.get(y) ?? [];
    list.push(e);
    map.set(y, list);
  }
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0]) // newest year first
    .map(([year, events]) => ({ year, events }));
}

export function makeYearMonth(year: number, month: number, lang: Lang = DEFAULT_LANG): YearMonth {
  const anchor = new Date(year, month - 1, 1);
  return {
    year,
    month,
    key: format(anchor, "yyyy-MM"),
    label: format(anchor, "MMMM yyyy", { locale: locales[lang] }),
    path: localePath(lang, `/${format(anchor, "yyyy")}/${format(anchor, "MM")}/`),
  };
}

export function symbolPath(lang: Lang, symbol: string): string {
  return localePath(lang, `/${symbol}/`);
}

export function yearPath(lang: Lang, year: number): string {
  return localePath(lang, `/year/${year}/`);
}

export function getPaymentYears(events: DividendEvent[]): number[] {
  const years = new Set<number>();
  for (const e of events) {
    if (e.paymentDate) years.add(Number(e.paymentDate.slice(0, 4)));
  }
  return [...years].sort((a, b) => a - b);
}

export type YearAggregateRow = {
  symbol: string;
  name: string;
  totalAmount: number;     // sum of confirmed amounts paid in the year
  count: number;           // total payments (incl. pending)
  pendingCount: number;    // payments scheduled but with null amount
};

export type YearAggregate = {
  year: number;
  rows: YearAggregateRow[];   // sorted by totalAmount desc, then symbol asc
  totalAmount: number;
  totalCount: number;
  pendingCount: number;
};

export function getYearAggregate(events: DividendEvent[], year: number): YearAggregate {
  const yearStr = String(year);
  const bySymbol = new Map<string, YearAggregateRow>();
  for (const e of events) {
    if (!e.paymentDate || e.paymentDate.slice(0, 4) !== yearStr) continue;
    const row = bySymbol.get(e.symbol) ?? {
      symbol: e.symbol,
      name: e.name,
      totalAmount: 0,
      count: 0,
      pendingCount: 0,
    };
    row.count += 1;
    if (typeof e.amount === "number") row.totalAmount += e.amount;
    else row.pendingCount += 1;
    bySymbol.set(e.symbol, row);
  }
  const rows = [...bySymbol.values()].sort(
    (a, b) => b.totalAmount - a.totalAmount || a.symbol.localeCompare(b.symbol),
  );
  const totalAmount = rows.reduce((s, r) => s + r.totalAmount, 0);
  const totalCount = rows.reduce((s, r) => s + r.count, 0);
  const pendingCount = rows.reduce((s, r) => s + r.pendingCount, 0);
  return { year, rows, totalAmount, totalCount, pendingCount };
}

export function currentYearMonth(now: Date = new Date(), lang: Lang = DEFAULT_LANG): YearMonth {
  return makeYearMonth(now.getFullYear(), now.getMonth() + 1, lang);
}

function shiftMonths(ym: YearMonth, delta: number, lang: Lang): YearMonth {
  const shifted = fnsAddMonths(new Date(ym.year, ym.month - 1, 1), delta);
  return makeYearMonth(shifted.getFullYear(), shifted.getMonth() + 1, lang);
}

export type MonthListResult = {
  months: YearMonth[];
  byKey: Map<string, YearMonth>;
};

export function getMonthList(events: DividendEvent[], lang: Lang = DEFAULT_LANG, now: Date = new Date()): MonthListResult {
  const today = currentYearMonth(now, lang);
  if (events.length === 0) {
    return { months: [today], byKey: new Map([[today.key, today]]) };
  }
  const dataKeys = events.map((e) => e.exDate.slice(0, 7));
  const minKey = dataKeys.reduce((a, b) => (a < b ? a : b));
  const maxKey = dataKeys.reduce((a, b) => (a > b ? a : b));
  const [minY, minM] = minKey.split("-").map(Number);
  const [maxY, maxM] = maxKey.split("-").map(Number);

  let first = shiftMonths(makeYearMonth(minY, minM, lang), -PAST_PADDING_MONTHS, lang);
  let last = shiftMonths(makeYearMonth(maxY, maxM, lang), 1, lang);
  const futureHorizon = shiftMonths(today, FUTURE_HORIZON_MONTHS, lang);
  if (today.key < first.key) first = today;
  if (futureHorizon.key > last.key) last = futureHorizon;

  const months: YearMonth[] = [];
  let cursor = first;
  while (cursor.key <= last.key) {
    months.push(cursor);
    cursor = shiftMonths(cursor, 1, lang);
  }
  const byKey = new Map(months.map((m) => [m.key, m]));
  return { months, byKey };
}

export type EntryKind = "xd" | "payment";

export type CalendarEntry = {
  kind: EntryKind;
  event: DividendEvent;
};

export function getEventsForMonth(events: DividendEvent[], ym: YearMonth): {
  byDay: Map<string, CalendarEntry[]>;
  totalXd: number;
  totalPayment: number;
} {
  const byDay = new Map<string, CalendarEntry[]>();
  let totalXd = 0;
  let totalPayment = 0;

  const push = (date: string, entry: CalendarEntry) => {
    const list = byDay.get(date) ?? [];
    list.push(entry);
    byDay.set(date, list);
  };

  for (const e of events) {
    if (e.exDate.startsWith(ym.key)) {
      push(e.exDate, { kind: "xd", event: e });
      totalXd += 1;
    }
    if (e.paymentDate?.startsWith(ym.key)) {
      push(e.paymentDate, { kind: "payment", event: e });
      totalPayment += 1;
    }
  }

  // Sort each day's entries: XD first (chronologically the cause), then payment.
  for (const list of byDay.values()) {
    list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "xd" ? -1 : 1;
      return a.event.symbol.localeCompare(b.event.symbol);
    });
  }

  return { byDay, totalXd, totalPayment };
}

export function getNeighbourMonths(months: YearMonth[], current: YearMonth): {
  prev: YearMonth | null;
  next: YearMonth | null;
} {
  const idx = months.findIndex((m) => m.key === current.key);
  return {
    prev: idx > 0 ? months[idx - 1] : null,
    next: idx >= 0 && idx < months.length - 1 ? months[idx + 1] : null,
  };
}

export type CalendarCell = {
  date: string; // YYYY-MM-DD
  day: number;
  inMonth: boolean;
  weekday: number; // 0=Sun
};

export function monthGridDays(year: number, month: number): CalendarCell[] {
  const first = new Date(year, month - 1, 1);
  const gridStart = startOfWeek(startOfMonth(first), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(addDaysFromStart(gridStart, 41), { weekStartsOn: 0 });
  return eachDayOfInterval({ start: gridStart, end: gridEnd })
    .slice(0, 42)
    .map((d) => ({
      date: format(d, "yyyy-MM-dd"),
      day: d.getDate(),
      inMonth: isSameMonth(d, first),
      weekday: getDay(d),
    }));
}

function addDaysFromStart(start: Date, days: number): Date {
  const d = new Date(start);
  d.setDate(d.getDate() + days);
  return d;
}

export function todayIso(now: Date = new Date()): string {
  return format(now, "yyyy-MM-dd");
}

export function formatExDate(iso: string): string {
  return format(parseISO(iso), "dd MMM yyyy");
}
