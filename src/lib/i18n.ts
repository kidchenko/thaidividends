import { format, parseISO } from "date-fns";
import { enUS, th as thLocale } from "date-fns/locale";

export type Lang = "en" | "th";
export const LANGS: readonly Lang[] = ["en", "th"];
export const DEFAULT_LANG: Lang = "en";
export const STORAGE_KEY = "lang";

const locales: Record<Lang, Locale> = { en: enUS, th: thLocale };

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

export function isLang(v: unknown): v is Lang {
  return v === "en" || v === "th";
}

export function readLang(): Lang {
  if (typeof document === "undefined") return DEFAULT_LANG;
  const v = document.documentElement.lang;
  return isLang(v) ? v : DEFAULT_LANG;
}

export function fmtDate(iso: string, pattern: string, lang: Lang): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), pattern, { locale: locales[lang] });
  } catch {
    return iso;
  }
}

export function localePath(lang: Lang, path: string = "/"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${BASE}/${lang}${p === "/" ? "/" : p}`;
}

export const dict = {
  en: {
    siteTitle: "Thai Dividends Calendar",
    siteDescription: "Ex-dividend calendar for SET50 stocks",
    footerNote: "Static site · Astro & Patchright · Source: SET",

    brand1: "Thai Dividends",
    brand2: "Calendar",
    volLine: "Vol. 01 · The Daily Ledger",
    tagline:
      "Ex-dividend & payment dates for SET-listed stocks. Sourced direct from the SET stock calendar.",

    searchPlaceholder: "Filter by symbol or name…",
    searchAria: "Filter by symbol or company name",
    clearSearch: "Clear search",

    pillExDividend: "ex-dividend",
    pillPayment: "payment",
    trackedAcross: "dividends tracked across",
    tickers: "tickers",
    noMatches: "— no matches in this month",

    toggleThemeAria: "Toggle colour theme",
    toggleThemeTitle: "Toggle theme",
    toggleLangAria: "Switch language",
    toggleLangTitle: "Switch language",

    weekdaysShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    weekdaysMin: ["S", "M", "T", "W", "T", "F", "S"],
    monthsAbbr: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    monthsFirst: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"],

    prevMonthAria: "Previous month",
    nextMonthAria: "Next month",
    jumpToToday: "Jump to today →",
    currentlyHere: "◆ Currently",

    badgeXd: "XD",
    badgePay: "PAY",
    fldExDate: "Ex-date",
    fldRecordDate: "Record date",
    fldPaymentDate: "Payment date",
    fldType: "Type",
    fldDividend: "Dividend",
    perShare: "/ share",
    fldSource: "Source",
    fldOperationPeriod: "Operation period",
    cashDividend: "Cash Dividend",
    pending: "Pending",
    dialogFooter: "Source · SET Stock Calendar",
    closeDialog: "Close",
    tentativeSuffix: "tentative",

    stockBack: "The Daily Ledger",
    stockBackCalendar: "Calendar",
    tickerLabel: "Ticker",

    statEvents: "Events",
    statTrackedSince: "Tracked since",
    statLast12Months: "Last 12 months",
    payoutOne: "payout",
    payoutMany: "payouts",
    nextExDate: "Next ex-date",
    nextPayment: "Next payment",
    lastPaid: "Last paid",
    paysPrefix: "pays",
    exPrefix: "ex",

    sectionDividends: "dividends",
    confirmedSuffix: "confirmed",
    sectionCadence: "Cadence",
    sectionCadenceSub: "when this stock pays",
    yearOne: "year",
    yearMany: "years",
    sectionHistory: "History",
    eventOne: "event",
    eventMany: "events",
    sinceLabel: "since",
    badgeUpcoming: "Upcoming",
    badgeTentative: "Tentative",
    paidVerb: "paid",

    noRecordsBefore: "No dividend records on file for",
    noRecordsAfter: ".",
    backToCalendar: "← Back to calendar",

    cadenceNoEvent: "No event",
    cadenceUpcoming: "upcoming",
    cadenceNoDividends: "No dividends",
    cadenceMoreDividends: "More dividends",
    cadenceNoHistory: "No dividend history to plot.",

    tlNoData: "No confirmed amounts to chart yet.",
    tlGroupBy: "Group by",
    tlGroupEvent: "Event",
    tlGroupYear: "Year",
    tlToday: "today",
    tlPaid: "paid",
    tlUpcoming: "upcoming",
    tlCompleteYear: "complete year",
    tlInProgress: "in progress",

    navCalendar: "Calendar",
    navAnnual: "Annual",
    annualLink: "Annual rankings →",
    annualTitle: "Annual rankings",
    annualSubtitle: "tickers ranked by total payments",
    prevYearAria: "Previous year",
    nextYearAria: "Next year",
    annualEmpty: "No payments recorded in this year.",
    rankColumn: "#",
    symbolColumn: "Ticker",
    totalColumn: "Total",
    annualTotalLabel: "total paid",
    annualPendingLabel: "pending",
    paymentsCountSuffix: "payments",
    paymentsCountSingular: "payment",
    sortLabel: "Sort",
    sortValue: "Value",
    sortTicker: "Ticker",
  },
  th: {
    siteTitle: "ปฏิทินเงินปันผลไทย",
    siteDescription: "ปฏิทินวันขึ้นเครื่องหมาย XD ของหุ้น SET50",
    footerNote: "เว็บไซต์สแตติก · Astro & Patchright · ที่มา: SET",

    brand1: "เงินปันผลไทย",
    brand2: "ปฏิทิน",
    volLine: "เล่มที่ 01 · เดอะเดลี่เลดเจอร์",
    tagline:
      "วันขึ้นเครื่องหมาย XD และวันจ่ายเงินปันผลของหุ้นในตลาดหลักทรัพย์ฯ ดึงข้อมูลตรงจากปฏิทินหุ้น SET",

    searchPlaceholder: "ค้นหาด้วยสัญลักษณ์หรือชื่อ…",
    searchAria: "ค้นหาด้วยสัญลักษณ์หรือชื่อบริษัท",
    clearSearch: "ล้างคำค้นหา",

    pillExDividend: "ขึ้น XD",
    pillPayment: "วันจ่ายปันผล",
    trackedAcross: "รายการเงินปันผล จาก",
    tickers: "หุ้น",
    noMatches: "— ไม่พบรายการในเดือนนี้",

    toggleThemeAria: "สลับธีมสี",
    toggleThemeTitle: "สลับธีม",
    toggleLangAria: "สลับภาษา",
    toggleLangTitle: "สลับภาษา",

    weekdaysShort: ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."],
    weekdaysMin: ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"],
    monthsAbbr: [
      "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
      "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
    ],
    monthsFirst: ["ม", "ก", "มี", "เ", "พ", "มิ", "ก", "ส", "ก", "ต", "พ", "ธ"],

    prevMonthAria: "เดือนก่อนหน้า",
    nextMonthAria: "เดือนถัดไป",
    jumpToToday: "ไปยังวันนี้ →",
    currentlyHere: "◆ ปัจจุบัน",

    badgeXd: "XD",
    badgePay: "จ่าย",
    fldExDate: "วันขึ้น XD",
    fldRecordDate: "วันปิดสมุดทะเบียน",
    fldPaymentDate: "วันจ่ายเงินปันผล",
    fldType: "ประเภท",
    fldDividend: "เงินปันผล",
    perShare: "/ หุ้น",
    fldSource: "แหล่งที่มา",
    fldOperationPeriod: "รอบผลการดำเนินงาน",
    cashDividend: "เงินปันผลเป็นเงินสด",
    pending: "รอประกาศ",
    dialogFooter: "ที่มา · ปฏิทินหุ้น SET",
    closeDialog: "ปิด",
    tentativeSuffix: "ยังไม่ยืนยัน",

    stockBack: "เดอะเดลี่เลดเจอร์",
    stockBackCalendar: "ปฏิทิน",
    tickerLabel: "หุ้น",

    statEvents: "จำนวนรายการ",
    statTrackedSince: "ติดตามตั้งแต่",
    statLast12Months: "12 เดือนล่าสุด",
    payoutOne: "ครั้ง",
    payoutMany: "ครั้ง",
    nextExDate: "วันขึ้น XD ถัดไป",
    nextPayment: "วันจ่ายปันผลถัดไป",
    lastPaid: "จ่ายล่าสุด",
    paysPrefix: "จ่าย",
    exPrefix: "XD",

    sectionDividends: "เงินปันผล",
    confirmedSuffix: "ยืนยันแล้ว",
    sectionCadence: "รอบการจ่าย",
    sectionCadenceSub: "ช่วงที่หุ้นนี้จ่ายเงินปันผล",
    yearOne: "ปี",
    yearMany: "ปี",
    sectionHistory: "ประวัติ",
    eventOne: "รายการ",
    eventMany: "รายการ",
    sinceLabel: "ตั้งแต่",
    badgeUpcoming: "กำลังจะมา",
    badgeTentative: "ยังไม่ยืนยัน",
    paidVerb: "จ่าย",

    noRecordsBefore: "ยังไม่มีข้อมูลเงินปันผลของ",
    noRecordsAfter: "",
    backToCalendar: "← กลับไปยังปฏิทิน",

    cadenceNoEvent: "ไม่มีรายการ",
    cadenceUpcoming: "กำลังจะมา",
    cadenceNoDividends: "ไม่มีเงินปันผล",
    cadenceMoreDividends: "มีเงินปันผลมาก",
    cadenceNoHistory: "ยังไม่มีประวัติให้แสดง",

    tlNoData: "ยังไม่มียอดที่ยืนยันให้แสดง",
    tlGroupBy: "จัดกลุ่มตาม",
    tlGroupEvent: "รายการ",
    tlGroupYear: "ปี",
    tlToday: "วันนี้",
    tlPaid: "จ่ายแล้ว",
    tlUpcoming: "กำลังจะมา",
    tlCompleteYear: "ปีเต็ม",
    tlInProgress: "ปีปัจจุบัน",

    navCalendar: "ปฏิทิน",
    navAnnual: "อันดับประจำปี",
    annualLink: "อันดับประจำปี →",
    annualTitle: "อันดับประจำปี",
    annualSubtitle: "หุ้นเรียงตามยอดจ่ายรวม",
    prevYearAria: "ปีก่อนหน้า",
    nextYearAria: "ปีถัดไป",
    annualEmpty: "ไม่มีการจ่ายในปีนี้",
    rankColumn: "#",
    symbolColumn: "หุ้น",
    totalColumn: "รวม",
    annualTotalLabel: "รวมจ่ายแล้ว",
    annualPendingLabel: "รอประกาศ",
    paymentsCountSuffix: "รายการ",
    paymentsCountSingular: "รายการ",
    sortLabel: "เรียงตาม",
    sortValue: "ยอดจ่าย",
    sortTicker: "หุ้น",
  },
} as const;

export type DictKey = keyof (typeof dict)["en"];

export function t(lang: Lang, key: DictKey | string): string {
  const d = dict[lang] as Record<string, unknown>;
  const fallback = dict[DEFAULT_LANG] as Record<string, unknown>;
  const v = d[key] ?? fallback[key];
  return typeof v === "string" ? v : "";
}

export function tArr(lang: Lang, key: DictKey | string): readonly string[] {
  const d = dict[lang] as Record<string, unknown>;
  const fallback = dict[DEFAULT_LANG] as Record<string, unknown>;
  const v = d[key] ?? fallback[key];
  return Array.isArray(v) ? (v as readonly string[]) : [];
}
