import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "patchright";

// Patchright also installed a "chrome" channel; using it improves stealth
// vs. the bundled Chromium.

const TARGET_YEAR = Number(process.argv[2] ?? new Date().getUTCFullYear());
const TARGET_MONTH = Number(process.argv[3] ?? new Date().getUTCMonth() + 1);

const PAGE_URL = `https://www.set.or.th/en/market/stock-calendar/x-calendar`;
const API_PATH_FRAGMENT = `/api/set/stock-calendar/${TARGET_YEAR}/${TARGET_MONTH}/x-calendar`;

const NAV_TIMEOUT_MS = 45_000;
const RESPONSE_WAIT_MS = 30_000;

async function main() {
  await mkdir("data", { recursive: true });
  console.log(`Target: ${TARGET_YEAR}-${String(TARGET_MONTH).padStart(2, "0")}`);
  console.log(`Listening for: ${API_PATH_FRAGMENT}`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    timezoneId: "Asia/Bangkok",
  });
  const page = await ctx.newPage();

  // Capture the JSON response BEFORE navigating; race against a timeout.
  const apiResponsePromise = page.waitForResponse(
    (resp) => resp.url().includes(API_PATH_FRAGMENT) && resp.status() === 200,
    { timeout: RESPONSE_WAIT_MS },
  );

  console.log(`Navigating to ${PAGE_URL} ...`);
  try {
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  } catch (err) {
    console.error("Navigation failed:", (err as Error).message);
    await browser.close();
    process.exit(1);
  }

  const title = await page.title();
  console.log(`Page title: ${title}`);
  if (/incapsula|access denied|attention required/i.test(title)) {
    console.error("BLOCKED — Incapsula challenge detected at page level.");
    await browser.close();
    process.exit(2);
  }

  console.log("Waiting for X Calendar API response ...");
  let payload: unknown;
  try {
    const apiResp = await apiResponsePromise;
    payload = await apiResp.json();
    console.log(`Got API response from: ${apiResp.url()}`);
  } catch (err) {
    console.error("API response not captured within timeout:", (err as Error).message);
    // Save the rendered HTML for inspection so we can see what happened.
    const html = await page.content();
    await writeFile("data/set-xcal-debug.html", html);
    console.error("Saved page HTML to data/set-xcal-debug.html");
    await browser.close();
    process.exit(3);
  }

  const outPath = `data/set-xcal-${TARGET_YEAR}-${String(TARGET_MONTH).padStart(2, "0")}.json`;
  await writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote → ${outPath}`);

  // Quick shape summary so we can see what we got without printing everything.
  if (Array.isArray(payload)) {
    console.log(`Response is array with ${payload.length} entries`);
    if (payload.length > 0) {
      console.log("First entry keys:", Object.keys(payload[0] as object));
      console.log("First entry:", JSON.stringify(payload[0], null, 2));
    }
  } else if (payload && typeof payload === "object") {
    console.log("Response keys:", Object.keys(payload as object));
    const sample = JSON.stringify(payload, null, 2);
    console.log("Sample (first 1500 chars):");
    console.log(sample.slice(0, 1500));
  }

  await browser.close();
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});
