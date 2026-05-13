// Probe SET company-profile + news endpoints by calling them directly from
// inside a bootstrapped Patchright page (same trick as set-fetch.ts). The
// earlier passive response listener got empty bodies on most calls.
import { chromium, type Page } from "patchright";

const SYMBOL = process.argv[2] ?? "AOT";

const BOOTSTRAP_URL = "https://www.set.or.th/en/market/stock-calendar/x-calendar";
const NAV_TIMEOUT_MS = 45_000;
const RESPONSE_WAIT_MS = 30_000;

const ENDPOINTS = [
  `/api/set/stock/${SYMBOL}/profile?lang=en`,
  `/api/set/company/${SYMBOL}/profile?lang=en`,
  `/api/set/stock/${SYMBOL}/company-highlight/financial-data?lang=en`,
  `/api/set/stock/${SYMBOL}/company-highlight/trading-stat?lang=en`,
  `/api/set/stock/${SYMBOL}/financialstatement/latest-full-financialstatement?lang=en`,
  `/api/set/company/${SYMBOL}/report/one?lang=en`,
  `/api/set/company/${SYMBOL}/report/annual?lang=en`,
  `/api/set/company/${SYMBOL}/report/form56?lang=en`,
  // News with keyword filter for financial statement submissions.
  `/api/set/news/search?symbol=${SYMBOL}&fromDate=13%2F05%2F2024&toDate=13%2F05%2F2026&keyword=Financial%20Statement&lang=en`,
];

async function bootstrap(page: Page): Promise<void> {
  const wait = page.waitForResponse(
    (r) => r.url().includes("/api/set/stock-calendar/") && r.status() === 200,
    { timeout: RESPONSE_WAIT_MS },
  );
  await page.goto(BOOTSTRAP_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  await wait;
}

async function callEndpoint(page: Page, url: string): Promise<{ status: number; body: unknown }> {
  return page.evaluate(async (u) => {
    const res = await fetch(u, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    return { status: res.status, body };
  }, url);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    timezoneId: "Asia/Bangkok",
  });
  const page = await ctx.newPage();
  console.log("Bootstrapping...");
  await bootstrap(page);
  console.log("Bootstrap OK.\n");

  for (const url of ENDPOINTS) {
    console.log(`=== ${url}`);
    try {
      const { status, body } = await callEndpoint(page, url);
      if (status !== 200) {
        console.log(`  status ${status}`);
        continue;
      }
      const json = JSON.stringify(body);
      console.log(`  ${json.length}b`);
      // Print the first 600 chars of pretty-printed body so we can spot fields.
      const pretty = JSON.stringify(body, null, 2);
      console.log(pretty.slice(0, 1200));
      console.log("---");
    } catch (err) {
      console.log(`  FAIL: ${(err as Error).message}`);
    }
  }

  await browser.close();
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});
