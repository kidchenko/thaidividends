import { writeFile, mkdir } from "node:fs/promises";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// Known dividend-announcement news IDs to test parser.
// In production these come from a list/discovery step (TODO).
const SAMPLES: Array<{ id: string; symbol: string }> = [
  { id: "86430700", symbol: "CAZ" },
  { id: "94801100", symbol: "KBANK" },
];

type Parsed = {
  symbol: string;
  newsId: string;
  title: string | null;
  exDividendDate: string | null;
  paymentDate: string | null;
  recordDate: string | null;
  amountBaht: number | null;
  parValueBaht: number | null;
  source: "set-news";
  fetchedAt: string;
};

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function normaliseDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (!month) return null;
  return `${m[3]}-${month}-${m[1]}`;
}

function extractField(haystack: string, label: string): string | null {
  // Labels in __NUXT__ payload look like:  `Ex-dividend date    : 12-Mar-2024`
  // Whitespace is variable; some are literal newlines, some are escaped \n.
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escapedLabel}\\s*:\\s*([^\\\\\\n"<]+?)(?=\\\\n|<|"|$)`, "i");
  const m = haystack.match(re);
  return m ? m[1].trim() : null;
}

function parseAmount(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function parseTitle(html: string): string | null {
  const m = html.match(/<title>([^<]+)<\/title>/);
  if (!m) return null;
  return m[1].replace(/\s*-\s*The Stock Exchange of Thailand\s*$/, "").trim();
}

async function fetchAndParse(id: string, symbol: string): Promise<Parsed> {
  const url = `https://www.set.or.th/en/market/news-and-alert/newsdetails?id=${id}&symbol=${symbol}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  if (html.includes("Incapsula")) {
    throw new Error("blocked by Incapsula");
  }

  const exRaw = extractField(html, "Ex-dividend date");
  const payRaw = extractField(html, "Payment date");
  const recRaw = extractField(html, "Record date for the right to receive");
  const amtRaw = extractField(html, "Cash dividend payment (baht per share)");
  const parRaw = extractField(html, "Par value (baht)");

  return {
    symbol,
    newsId: id,
    title: parseTitle(html),
    exDividendDate: normaliseDate(exRaw),
    paymentDate: normaliseDate(payRaw),
    recordDate: normaliseDate(recRaw),
    amountBaht: parseAmount(amtRaw),
    parValueBaht: parseAmount(parRaw),
    source: "set-news",
    fetchedAt: new Date().toISOString(),
  };
}

async function main() {
  await mkdir("data", { recursive: true });
  const results: Parsed[] = [];
  for (const s of SAMPLES) {
    process.stdout.write(`${s.symbol} (id=${s.id})... `);
    try {
      const parsed = await fetchAndParse(s.id, s.symbol);
      console.log("ok");
      console.log(`  title:        ${parsed.title}`);
      console.log(`  ex-div date:  ${parsed.exDividendDate}`);
      console.log(`  record date:  ${parsed.recordDate}`);
      console.log(`  payment date: ${parsed.paymentDate}`);
      console.log(`  amount:       ${parsed.amountBaht} THB/share`);
      console.log(`  par value:    ${parsed.parValueBaht} THB`);
      console.log();
      results.push(parsed);
    } catch (err) {
      console.log(`FAILED — ${(err as Error).message}`);
    }
  }
  const out = "data/set-news-dividends.json";
  await writeFile(out, JSON.stringify(results, null, 2));
  console.log(`Wrote ${results.length} parsed disclosures → ${out}`);
}

main();
