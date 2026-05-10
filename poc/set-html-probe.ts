import { writeFile } from "node:fs/promises";
import { chromium, type Page } from "patchright";

const SYMBOL = (process.argv[2] || "PTT").toUpperCase();
const BASE = "https://www.set.or.th";

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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await bootstrap(page);

  await page.goto(`${BASE}/en/market/product/stock/quote/${SYMBOL}/financial-statement/income-statement`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  
  // Wait a bit for any async renders
  await new Promise((r) => setTimeout(r, 3000));
  
  const html = await page.content();
  await writeFile(`/tmp/${SYMBOL}-income.html`, html);
  
  // Extract all year-like patterns and any key financial labels
  const yearMatches = [...html.matchAll(/\b(20\d{2})\b/g)].map((m) => m[1]);
  const uniqYears = [...new Set(yearMatches)].sort();
  
  // Check if there's tabular data
  const tables = await page.$$eval("table", (els) =>
    els.map((t) => ({
      rows: t.querySelectorAll("tr").length,
      headers: [...t.querySelectorAll("th")].map((h) => h.textContent?.trim().slice(0, 30) || "").slice(0, 10),
    }))
  );
  
  console.log(`HTML size: ${html.length}`);
  console.log(`Unique years found in HTML: ${uniqYears.join(", ")}`);
  console.log(`Tables found: ${tables.length}`);
  for (const t of tables) {
    console.log(`  rows=${t.rows} headers=[${t.headers.join(" | ")}]`);
  }
  
  // Look for the specific columns of the income statement
  const dataDots = html.match(/Total Revenue|Net Profit|EPS|Sales|EBITDA/g);
  console.log(`Financial labels in HTML: ${dataDots?.length || 0} matches`);
  
  await browser.close();
}

main().catch(console.error);
