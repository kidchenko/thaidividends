/**
 * Hit the SET financial-statement income-statement page, simulate user
 * interactions (year/period dropdowns), and capture every XHR fired so we
 * see whether deeper history is reachable through the website itself.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
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
  await mkdir(`data/probe/set/${SYMBOL}/page`, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await bootstrap(page);

  const seen = new Set<string>();
  const captures: Array<{ url: string; status: number; bytes: number; body: unknown }> = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    if (!url.includes("/api/set/")) return;
    if (seen.has(url)) return;
    seen.add(url);
    const ct = resp.headers()["content-type"] ?? "";
    if (!ct.includes("application/json")) return;
    try {
      const body = await resp.json();
      captures.push({ url, status: resp.status(), bytes: JSON.stringify(body).length, body });
    } catch {}
  });

  // Visit income-statement
  await page.goto(`${BASE}/en/market/product/stock/quote/${SYMBOL}/financial-statement/income-statement`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await sleep(3_000);

  // Print every button / select / link visible — to see what controls exist
  const controls = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll("button, select, a[role='button'], [role='tab']").forEach((el) => {
      const text = (el.textContent ?? "").trim().slice(0, 40);
      const cls = (el as HTMLElement).className?.toString().slice(0, 40);
      if (text) out.push(`<${el.tagName.toLowerCase()}> "${text}" .${cls}`);
    });
    return out.slice(0, 80);
  });

  // Look at __NEXT_DATA__ if present
  const nextData = await page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    return el?.textContent ?? null;
  });

  // Click on "Quarterly" tab if it exists
  const tabs = await page.$$("button, [role='tab']");
  let clickedQuarter = false;
  for (const t of tabs) {
    const txt = (await t.textContent() || "").trim();
    if (/^(Quarter(ly)?|รายไตรมาส)$/i.test(txt)) {
      try {
        await t.click({ timeout: 2000 });
        clickedQuarter = true;
        await sleep(2000);
        break;
      } catch {}
    }
  }

  // Find any "year" dropdowns and try clicking one
  const yearOptions: string[] = [];
  const selects = await page.$$("select");
  for (const s of selects) {
    const opts = await s.$$eval("option", (els) =>
      (els as HTMLOptionElement[]).map((o) => o.textContent?.trim() ?? ""),
    );
    yearOptions.push(...opts);
  }

  await browser.close();

  await writeFile(
    `data/probe/set/${SYMBOL}/page/controls.json`,
    JSON.stringify({ controls, yearOptions, clickedQuarter }, null, 2),
  );
  if (nextData) {
    await writeFile(`data/probe/set/${SYMBOL}/page/__NEXT_DATA__.json`, nextData);
  }
  for (let i = 0; i < captures.length; i++) {
    const c = captures[i];
    const fname = `${String(i + 1).padStart(2, "0")}__${c.url.replace(/^https?:\/\/[^/]+/, "").replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 100)}.json`;
    await writeFile(`data/probe/set/${SYMBOL}/page/${fname}`, JSON.stringify(c.body, null, 2));
  }

  console.log(`Captures: ${captures.length}`);
  console.log("Controls (first 30):");
  controls.slice(0, 30).forEach((c) => console.log("  " + c));
  console.log(`\nyearOptions found: ${yearOptions.length}: ${yearOptions.slice(0, 10).join(" | ")}`);
  console.log(`Clicked quarterly tab: ${clickedQuarter}`);
  console.log(`__NEXT_DATA__ present: ${!!nextData}; size=${nextData?.length ?? 0}`);
  console.log("Endpoints captured:");
  captures.forEach((c) => console.log(`  [${c.bytes}b] ${c.url}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
