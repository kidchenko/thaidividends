import { buildCompareManifest, type CompareEntry } from "./compare";

export type SectorStats = {
  sector: string;
  count: number;
  peMedian: number | null;
  yldMedian: number | null;
  payoutMedian: number | null;
};

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

let _cache: Map<string, SectorStats> | null = null;

function buildSectorStats(): Map<string, SectorStats> {
  if (_cache) return _cache;
  const manifest = buildCompareManifest();
  const groups = new Map<string, CompareEntry[]>();
  for (const e of manifest.entries) {
    if (!e.sec) continue;
    const list = groups.get(e.sec) ?? [];
    list.push(e);
    groups.set(e.sec, list);
  }
  const out = new Map<string, SectorStats>();
  for (const [sector, entries] of groups) {
    const pe = entries.map((e) => e.pe).filter((v): v is number => v !== null && v > 0 && v < 200);
    const yld = entries.map((e) => e.yld).filter((v): v is number => v !== null && v > 0 && v < 0.5);
    const pay = entries.map((e) => e.pay).filter((v): v is number => v !== null && v >= 0 && v <= 2);
    out.set(sector, {
      sector,
      count: entries.length,
      peMedian: median(pe),
      yldMedian: median(yld),
      payoutMedian: median(pay),
    });
  }
  _cache = out;
  return out;
}

export function getSectorStats(sector: string | null | undefined): SectorStats | null {
  if (!sector) return null;
  return buildSectorStats().get(sector) ?? null;
}
