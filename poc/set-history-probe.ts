/**
 * Probe SET fundamentals API for historical depth.
 *
 * Tries different query-param strategies on /api/set/stock/{symbol}/...
 * to see whether we can reach beyond the default 5-year window the website
 * displays.  Logs the year range returned by each variant.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type Page } from "patchright";

const SYMBOL = (process.argv[2] || "PTT").toUpperCase();
const BASE = "https://www.set.or.th";

const VARIANTS: Array<{ label: string; url: string }> = [
  // What we already know works:
  { label: "annual default", url: `/api/set/stock/${SYMBOL}/company-highlight/financial-data?lang=en` },
  // Quarterly variants
  { label: "fsType=Q", url: `/api/set/stock/${SYMBOL}/company-highlight/financial-data?lang=en&fsType=Q` },
  { label: "frequency=Q", url: `/api/set/stock/${SYMBOL}/company-highlight/financial-data?lang=en&frequency=Q` },
  { label: "period=quarter", url: `/api/set/stock/${SYMBOL}/company-highlight/financial-data?lang=en&period=quarter` },
  { label: "type=quarterly", url: `/api/set/stock/${SYMBOL}/company-highlight/financial-data?lang=en&type=quarterly` },
  // Range variants
  { label: "year=2016 alt", url: `/api/set/stock/${SYMBOL}/company-highlight/financial-data/2016?lang=en` },
  { label: "/financial-data/all", url: `/api/set/stock/${SYMBOL}/company-highlight/financial-data/all?lang=en` },
  { label: "history endpoint", url: `/api/set/stock/${SYMBOL}/company-highlight/historical?lang=en` },
  { label: "highlight 2016", url: `/api/set/stock/${SYMBOL}/company-highlight/financial-data?lang=en&endYear=2020` },
  // Other endpoints worth probing
  { label: "fact-sheet", url: `/api/set/stock/${SYMBOL}/fact-sheet?lang=en` },
  { label: "info", url: `/api/set/stock/${SYMBOL}/info?lang=en` },
  { label: "profile", url: `/api/set/stock/${SYMBOL}/profile?lang=en` },
  { label: "stat-history", url: `/api/set/stock/${SYMBOL}/historical-trading?lang=en` },
];

async function bootstrap(page: Page): Promise<void> {
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes("/api/set/") && r.status() === 200,
    { timeout: 30_000 },
  );
  await page.goto(`${BASE}/en/market/stock-calendar/x-calendar`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await responsePromise;
}

async function fetchJson(page: Page, url: string): Promise<{ status: number; body: unknown }> {
  return page.evaluate(async (u) => {
    const res = await fetch(u, { credentials: "include", headers: { Accept: "application/json" } });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }, url);
}

function summarize(label: string, status: number, body: unknown): string {
  if (status !== 200) return `${label}: HTTP ${status}`;
  if (!body) return `${label}: empty body`;
  if (Array.isArray(body)) {
    const years = body
      .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>).year : undefined))
      .filter((y) => typeof y === "number") as number[];
    const quarters = body
      .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>).quarter : undefined))
      .filter((q) => q !== undefined);
    return `${label}: array len=${body.length}; years=${years.length ? `${Math.min(...years)}–${Math.max(...years)}` : "—"}; quarters=${[...new Set(quarters)].join(",") || "—"}`;
  }
  if (typeof body === "object") {
    const keys = Object.keys(body as Record<string, unknown>).slice(0, 10).join(",");
    return `${label}: object keys=${keys}`;
  }
  return `${label}: ${typeof body}`;
}

async function main() {
  await mkdir(`data/probe/set/${SYMBOL}/history`, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  console.log("Bootstrapping…");
  await bootstrap(page);
  console.log("Probing variants:\n");

  for (const v of VARIANTS) {
    try {
      const { status, body } = await fetchJson(page, v.url);
      console.log("  " + summarize(v.label, status, body));
      await writeFile(
        `data/probe/set/${SYMBOL}/history/${v.label.replace(/[^a-z0-9]+/gi, "_")}.json`,
        JSON.stringify({ url: v.url, status, body }, null, 2),
      );
    } catch (err) {
      console.log(`  ${v.label}: ERROR ${(err as Error).message}`);
    }
    await sleep(200);
  }

  await browser.close();
  console.log(`\nFiles written → data/probe/set/${SYMBOL}/history/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
