// Glue between DividendEvent records and the iCal builder.
//
// Each dividend record yields up to two calendar events:
//   - one on the ex-date (always)
//   - one on the payment date (if known)
//
// Titles stay short so they read in a calendar grid; full detail goes into the
// description body. UIDs are stable so re-fetched feeds update events in place.

import type { DividendEvent } from "./dividends";
import type { IcsEvent } from "./ical";

export type FeedOpts = {
  siteUrl: string;       // e.g. "https://kidchenko.github.io"
  basePath: string;      // e.g. "/thaidividends" or ""
  cutoffIso?: string;    // optional: include only events with date >= cutoff
};

export function eventsToIcsEvents(events: DividendEvent[], opts: FeedOpts): IcsEvent[] {
  const out: IcsEvent[] = [];
  for (const e of events) {
    const url = stockUrl(opts, e.symbol);
    if (passes(e.exDate, opts.cutoffIso)) {
      out.push(buildXd(e, url));
    }
    if (e.paymentDate && passes(e.paymentDate, opts.cutoffIso)) {
      out.push(buildPayment(e, url));
    }
  }
  return out;
}

function passes(iso: string | null, cutoff?: string): iso is string {
  return iso != null && (cutoff == null || iso >= cutoff);
}

function stockUrl(opts: FeedOpts, symbol: string): string {
  return `${opts.siteUrl}${opts.basePath}/en/${encodeURIComponent(symbol)}/`;
}

function buildXd(e: DividendEvent, url: string): IcsEvent {
  const tentative = e.tentative ? " *" : "";
  const summary = `${e.symbol} ${e.caType} ${amountTag(e.amount)}${tentative}`;
  return {
    uid: `${slug(e.symbol)}-xd-${e.exDate}-${slug(e.caType)}@thaidividends`,
    date: e.exDate,
    summary,
    description: describe(e, "Ex-dividend date"),
    url,
  };
}

function buildPayment(e: DividendEvent, url: string): IcsEvent {
  const tentative = e.tentative ? " *" : "";
  const summary = `${e.symbol} pays ${amountTag(e.amount)}${tentative}`;
  return {
    uid: `${slug(e.symbol)}-pay-${e.exDate}-${e.paymentDate}-${slug(e.caType)}@thaidividends`,
    date: e.paymentDate as string,
    summary,
    description: describe(e, "Dividend payment"),
    url,
  };
}

// Lowercase + alphanumeric/hyphen only - stable across rebuilds.
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function amountTag(amount: number | null): string {
  return amount == null ? "(pending)" : `฿${formatAmount(amount)}`;
}

function formatAmount(n: number): string {
  // Mirrors the site formatter: 4 decimals with trailing zeros trimmed past 2dp.
  return n.toFixed(4).replace(/(\.\d{2})0+$/, "$1");
}

function describe(e: DividendEvent, headline: string): string {
  const parts: string[] = [];
  parts.push(headline);
  parts.push(e.name);
  if (e.dividendType && e.dividendType !== "Cash Dividend") {
    parts.push(`Type: ${e.dividendType}`);
  }
  parts.push(`Amount: ${amountTag(e.amount)} per share`);
  parts.push(`Ex-date: ${e.exDate}`);
  parts.push(`Payment: ${e.paymentDate ?? "TBA"}`);
  if (e.sourceOfDividend) parts.push(`Source: ${e.sourceOfDividend}`);
  if (e.operationStart && e.operationEnd) {
    parts.push(`Operation: ${e.operationStart} -> ${e.operationEnd}`);
  }
  if (e.tentative) parts.push("Note: tentative - subject to confirmation");
  if (e.remark) parts.push(`Remark: ${e.remark}`);
  return parts.join("\n");
}
