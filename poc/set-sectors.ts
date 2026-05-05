// Fetches SET's industry/sector classification for every listed symbol and
// merges it into data/companies.json. Run with: npx tsx poc/set-sectors.ts
//
// Source: /api/set/stock/list — single bulk endpoint with industry, sector,
// market, securityType, and the isIFF (Infrastructure Fund) flag.

import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type Page } from "patchright";

const BOOTSTRAP_URL = "https://www.set.or.th/en/market/index/set/industries";
const STOCK_LIST_URL = "/api/set/stock/list";
const NAV_TIMEOUT_MS = 45_000;

type SetSecurity = {
  symbol: string;
  nameTH: string;
  nameEN: string;
  market: string;             // "SET" | "mai"
  securityType: string;       // "S" stock, "P" preferred, "W" warrant, "F" ETF/Fund, "L" DR, etc.
  industry: string;           // "AGRO" | "CONSUMP" | "FINCIAL" | "INDUS" | "PROPCON" | "RESOURC" | "SERVICE" | "TECH" | ""
  sector: string;             // sector slug
  isIFF: boolean;             // Infrastructure Fund flag
  isForeignListing: boolean;
  remark: string;
};

type ExistingCompany = {
  symbol: string;
  name: string;
  currency: string;
  // Optional sector fields — preserved if already present.
  market?: string;
  securityType?: string;
  industry?: string;
  sector?: string;
  isIFF?: boolean;
};

async function bootstrap(page: Page): Promise<void> {
  // Loading any SET page lets the Incapsula challenge complete and gives us
  // cookies we can use for direct API calls afterwards.
  await page.goto(BOOTSTRAP_URL, {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT_MS,
  });
  // First render usually fires /api/set/stock/list itself; wait briefly so the
  // session settles before our explicit fetch.
  await sleep(1500);
}

async function fetchStockList(page: Page): Promise<SetSecurity[]> {
  const payload = await page.evaluate(async (u) => {
    const res = await fetch(u, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, STOCK_LIST_URL);
  if (!payload || typeof payload !== "object") {
    throw new Error("unexpected response shape");
  }
  const arr = (payload as { securitySymbols?: unknown }).securitySymbols;
  if (!Array.isArray(arr)) {
    throw new Error("missing securitySymbols array");
  }
  return arr as SetSecurity[];
}

async function loadExisting(): Promise<ExistingCompany[]> {
  try {
    const raw = await readFile("data/companies.json", "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    timezoneId: "Asia/Bangkok",
  });
  const page = await ctx.newPage();

  console.log("Bootstrapping browser context (Incapsula challenge)...");
  await bootstrap(page);

  console.log("Fetching /api/set/stock/list ...");
  const securities = await fetchStockList(page);
  console.log(`  got ${securities.length} securities`);

  await browser.close();

  // Build a quick lookup: symbol → security from the SET data.
  const bySymbol = new Map<string, SetSecurity>();
  for (const s of securities) {
    bySymbol.set(s.symbol, s);
  }

  // Enhance existing companies.json with sector data — don't introduce new
  // entries from SET. companies.json is derived from observed dividend events,
  // so adding warrants/DRs/foreign-board duplicates would just bloat the
  // directory with noise the user has no use for.
  const existing = await loadExisting();
  const merged: ExistingCompany[] = [];
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const c of existing) {
    const s = bySymbol.get(c.symbol);
    if (s) {
      merged.push({
        symbol: c.symbol,
        name: s.nameEN || c.name,
        currency: c.currency,
        market: s.market,
        securityType: s.securityType,
        industry: s.industry || undefined,
        sector: s.sector || undefined,
        isIFF: s.isIFF,
      });
      matchedCount++;
    } else {
      // SET no longer lists this symbol (delisted, renamed). Keep the entry
      // so per-symbol pages still render historical dividends.
      merged.push(c);
      unmatchedCount++;
    }
  }

  merged.sort((a, b) => a.symbol.localeCompare(b.symbol));

  console.log(`Existing entries enhanced: ${matchedCount}/${existing.length}`);
  console.log(`Unmatched (kept as-is):    ${unmatchedCount}`);

  await writeFile("data/companies.json", JSON.stringify(merged, null, 2));

  // Stats — quick distribution to sanity-check the merge.
  const stats = {
    total: merged.length,
    withSector: merged.filter((c) => c.industry).length,
    iff: merged.filter((c) => c.isIFF).length,
    byIndustry: new Map<string, number>(),
    bySecurityType: new Map<string, number>(),
    byMarket: new Map<string, number>(),
  };
  for (const c of merged) {
    if (c.industry) {
      stats.byIndustry.set(c.industry, (stats.byIndustry.get(c.industry) ?? 0) + 1);
    }
    if (c.securityType) {
      stats.bySecurityType.set(
        c.securityType,
        (stats.bySecurityType.get(c.securityType) ?? 0) + 1,
      );
    }
    if (c.market) {
      stats.byMarket.set(c.market, (stats.byMarket.get(c.market) ?? 0) + 1);
    }
  }

  console.log();
  console.log(`Total companies:       ${stats.total}`);
  console.log(`With sector data:      ${stats.withSector}`);
  console.log(`Infrastructure funds:  ${stats.iff}`);
  console.log(`\nBy industry:`);
  for (const [k, n] of [...stats.byIndustry.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(10)} ${n}`);
  }
  console.log(`\nBy security type:`);
  for (const [k, n] of [...stats.bySecurityType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(4)} ${n}`);
  }
  console.log(`\nBy market:`);
  for (const [k, n] of [...stats.byMarket.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(6)} ${n}`);
  }
  console.log();
  console.log("Wrote → data/companies.json");
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});
