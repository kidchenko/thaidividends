// Minimal RFC 5545 iCalendar builder for the Thai Dividends static site.
//
// Emits VEVENTs as all-day dates (DTSTART;VALUE=DATE) which is the only thing
// dividend feeds need. Handles UTF-8-safe line folding, TEXT escaping, and
// publishes the metadata calendar apps look at when subscribing.
//
// Usage:
//   buildIcs({ name, events: [{ uid, date, summary, description?, url? }] })

export type IcsEvent = {
  uid: string;          // Stable identifier — calendar apps key updates off this.
  date: string;         // YYYY-MM-DD (all-day, exclusive end is computed as next day).
  summary: string;      // Title shown in the calendar grid.
  description?: string; // Multi-line allowed; \n becomes literal line breaks.
  url?: string;         // Optional URL associated with the event.
};

export type IcsCalendar = {
  name: string;
  description?: string;
  events: IcsEvent[];
  refreshHours?: number; // Hint to clients on how often to re-fetch (default 12h).
};

const PRODID = "-//thaidividends//Calendar//EN";
const TIMEZONE = "Asia/Bangkok";

export function buildIcs(cal: IcsCalendar, now: Date = new Date()): string {
  const refresh = cal.refreshHours ?? 12;
  const dtstamp = utcStamp(now);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escText(cal.name)}`,
    `X-WR-TIMEZONE:${TIMEZONE}`,
    `REFRESH-INTERVAL;VALUE=DURATION:PT${refresh}H`,
    `X-PUBLISHED-TTL:PT${refresh}H`,
  ];
  if (cal.description) {
    lines.push(`X-WR-CALDESC:${escText(cal.description)}`);
  }

  for (const e of cal.events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${ymd(e.date)}`);
    lines.push(`DTEND;VALUE=DATE:${nextDayYmd(e.date)}`);
    lines.push(`SUMMARY:${escText(e.summary)}`);
    if (e.description) {
      lines.push(`DESCRIPTION:${escText(e.description)}`);
    }
    if (e.url) {
      lines.push(`URL:${e.url}`);
    }
    lines.push("TRANSP:TRANSPARENT");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function escText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function ymd(iso: string): string {
  return iso.replace(/-/g, "");
}

function nextDayYmd(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function utcStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

// RFC 5545 §3.1: lines >75 octets must be folded with CRLF + single whitespace.
// We split on UTF-8 byte boundaries so multi-byte chars (e.g. Thai) survive.
const enc = new TextEncoder();
const dec = new TextDecoder();
function foldLine(line: string): string {
  const bytes = enc.encode(line);
  if (bytes.length <= 75) return line;
  const chunks: Uint8Array[] = [];
  let start = 0;
  while (start < bytes.length) {
    const limit = chunks.length === 0 ? 75 : 74; // 1 byte saved for the leading space
    let end = Math.min(start + limit, bytes.length);
    if (end < bytes.length) {
      // Back off until we're not in the middle of a UTF-8 continuation.
      while (end > start && (bytes[end] & 0xc0) === 0x80) end--;
    }
    chunks.push(bytes.slice(start, end));
    start = end;
  }
  return chunks.map((c) => dec.decode(c)).join("\r\n ");
}
