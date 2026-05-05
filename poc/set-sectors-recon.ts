// Recon script: discovers which SET API endpoints expose industry/sector
// classification by navigating their stock pages and recording API traffic.
// Run with: npx tsx poc/set-sectors-recon.ts

import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "patchright";

const PROBES = [
  "https://www.set.or.th/en/market/index/set/industries",
  "https://www.set.or.th/en/market/get-quote/stock/PTT",
  "https://www.set.or.th/en/market/get-quote/stock/CPNREIT",
];

const NAV_TIMEOUT_MS = 45_000;

type Captured = {
  page: string;
  url: string;
  method: string;
  status: number;
  bodyPreview: string;
};

async function main() {
  await mkdir("data/_recon", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    timezoneId: "Asia/Bangkok",
  });
  const page = await ctx.newPage();

  const captured: Captured[] = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/api/set/")) return;
    try {
      const txt = await response.text();
      captured.push({
        page: page.url(),
        url,
        method: response.request().method(),
        status: response.status(),
        bodyPreview: txt.slice(0, 800),
      });
    } catch {
      // streaming bodies sometimes throw — skip
    }
  });

  for (const probe of PROBES) {
    console.log(`→ ${probe}`);
    try {
      await page.goto(probe, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      // Let SPA finish hydrating + firing follow-up API calls.
      await sleep(3000);
    } catch (err) {
      console.log(`  failed: ${(err as Error).message}`);
    }
  }

  await browser.close();

  const summary = captured.map((c) => `[${c.status}] ${c.method} ${c.url}`).join("\n");
  console.log("\n=== captured /api/set calls ===\n");
  console.log(summary);

  await writeFile("data/_recon/calls.json", JSON.stringify(captured, null, 2));
  console.log(`\nWrote ${captured.length} captured calls → data/_recon/calls.json`);
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});
