import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import YahooFinance from "yahoo-finance2";

const COMPANIES_PATH = "data/companies.json";
const OUTPUT_PATH = "data/prices.json";
const BATCH_SIZE = 100;
const DELAY_BETWEEN_BATCHES_MS = 200;

type Company = { symbol: string; name: string; currency: string };

type PriceSnapshot = {
  close: number;
  change: number;
  changePercent: number;
  asOfDate: string; // YYYY-MM-DD (from Yahoo's regularMarketTime)
};

type PricesFile = {
  asOf: string;     // ISO timestamp of when this fetch ran
  prices: Record<string, PriceSnapshot>;
};

const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

async function main() {
  const raw = await readFile(COMPANIES_PATH, "utf8");
  const companies = JSON.parse(raw) as Company[];
  const totalBatches = Math.ceil(companies.length / BATCH_SIZE);
  console.log(
    `Yahoo prices fetch — ${companies.length} symbols in ${totalBatches} batches of ${BATCH_SIZE}`,
  );
  console.log();

  const prices: Record<string, PriceSnapshot> = {};
  const failed: string[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    const chunk = companies.slice(i, i + BATCH_SIZE);
    const yahooSymbols = chunk.map((c) => `${c.symbol}.BK`);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`  [${String(batchNum).padStart(2)}/${totalBatches}] `);

    try {
      const quotes = await yahoo.quote(yahooSymbols);
      const returnedSymbols = new Set<string>();
      let okCount = 0;
      for (const q of quotes) {
        const sym = q.symbol?.replace(/\.BK$/, "") ?? "";
        returnedSymbols.add(sym);
        if (typeof q.regularMarketPrice === "number") {
          prices[sym] = {
            close: q.regularMarketPrice,
            change: q.regularMarketChange ?? 0,
            changePercent: q.regularMarketChangePercent ?? 0,
            asOfDate:
              q.regularMarketTime?.toISOString?.().slice(0, 10) ??
              now.slice(0, 10),
          };
          okCount++;
        }
      }
      for (const c of chunk) {
        if (!returnedSymbols.has(c.symbol)) failed.push(c.symbol);
      }
      console.log(`${okCount}/${chunk.length} OK`);
    } catch (err) {
      console.log(`FAIL — ${(err as Error).message}`);
      for (const c of chunk) failed.push(c.symbol);
    }

    if (i + BATCH_SIZE < companies.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  await mkdir("data", { recursive: true });
  const out: PricesFile = { asOf: now, prices };
  await writeFile(OUTPUT_PATH, JSON.stringify(out, null, 2));

  console.log();
  console.log(`Symbols with prices: ${Object.keys(prices).length}/${companies.length}`);
  console.log(`Without coverage:    ${failed.length}`);
  console.log(`Wrote → ${OUTPUT_PATH}`);

  if (failed.length > 0 && failed.length <= 30) {
    console.log();
    console.log("Without Yahoo coverage:");
    console.log("  " + failed.join(", "));
  }
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});
