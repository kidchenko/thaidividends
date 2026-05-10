/**
 * Probe SET's financial-statement pages for one symbol to discover what
 * fundamentals data is exposed (which endpoints, which fields, how many years).
 *
 * Usage:
 *   npx tsx poc/set-probe.ts PTT
 *
 * Writes captured JSON XHR responses to data/probe/set/<symbol>/<n>__<path>.json
 * and prints a summary of every endpoint hit, so we can decide what to scrape.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type BrowserContext, type Page } from "patchright";

const SYMBOL = (process.argv[2] || "PTT").toUpperCase();

const BASE = "https://www.set.or.th";
const PAGES = [
  `/en/market/product/stock/quote/${SYMBOL}/financial-statement/company-highlights`,
  `/en/market/product/stock/quote/${SYMBOL}/financial-statement/income-statement`,
  `/en/market/product/stock/quote/${SYMBOL}/financial-statement/balance-sheet`,
  `/en/market/product/stock/quote/${SYMBOL}/financial-statement/cash-flow`,
  `/en/market/product/stock/quote/${SYMBOL}/financial-statement/financial-ratio`,
];

const NAV_TIMEOUT_MS = 45_000;
const QUIET_MS = 2_500;

type Capture = {
  page: string;
  url: string;
  status: number;
  contentType: string;
  bytes: number;
  body: unknown;
};

async function bootstrapWithCalendar(page: Page): Promise<void> {
  // Same Incapsula warmup as set-fetch.ts — visit any page that fires an
  // /api/set/* call so we know cookies are set before we navigate to financials.
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes("/api/set/") && r.status() === 200,
    { timeout: 30_000 },
  );
  await page.goto(`${BASE}/en/market/stock-calendar/x-calendar`, {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT_MS,
  });
  await responsePromise;
}

async function capturePage(
  page: Page,
  pagePath: string,
  captures: Capture[],
): Promise<void> {
  const seen = new Set<string>();
  const handler = async (response: import("patchright").Response) => {
    const url = response.url();
    if (!url.includes("/api/set/")) return;
    if (seen.has(url)) return;
    seen.add(url);
    const ct = response.headers()["content-type"] ?? "";
    if (!ct.includes("application/json")) return;
    try {
      const body = await response.json();
      const text = JSON.stringify(body);
      captures.push({
        page: pagePath,
        url,
        status: response.status(),
        contentType: ct,
        bytes: text.length,
        body,
      });
    } catch {
      // ignore non-JSON or in-flight bodies
    }
  };
  page.on("response", handler);

  await page.goto(`${BASE}${pagePath}`, {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT_MS,
  });

  // Let lazy XHRs settle.
  await sleep(QUIET_MS);
  page.off("response", handler);
}

function safeName(url: string): string {
  return url
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .slice(0, 120);
}

async function main() {
  const outDir = `data/probe/set/${SYMBOL}`;
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    timezoneId: "Asia/Bangkok",
  });
  const page = await ctx.newPage();

  console.log(`Probing SET for ${SYMBOL}…`);
  console.log("Bootstrap (Incapsula warmup)…");
  await bootstrapWithCalendar(page);

  const captures: Capture[] = [];
  for (const path of PAGES) {
    console.log(`\n→ ${path}`);
    try {
      await capturePage(page, path, captures);
    } catch (err) {
      console.log(`  page failed: ${(err as Error).message}`);
    }
  }

  await browser.close();

  // Write each capture to its own file for inspection.
  let i = 0;
  for (const c of captures) {
    i++;
    const fname = `${String(i).padStart(2, "0")}__${safeName(c.url)}.json`;
    await writeFile(`${outDir}/${fname}`, JSON.stringify(c.body, null, 2));
  }

  // Print summary.
  console.log("\n=== Summary ===");
  console.log(`Captured ${captures.length} JSON responses → ${outDir}`);
  for (const c of captures) {
    const top = c.body && typeof c.body === "object"
      ? Object.keys(c.body as Record<string, unknown>).slice(0, 8).join(", ")
      : typeof c.body;
    console.log(
      `  [${c.bytes.toString().padStart(7)}b] ${c.url}\n    keys: ${top || "(empty)"}`,
    );
  }
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});
