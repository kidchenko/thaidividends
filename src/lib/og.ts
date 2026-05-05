// Build-time OG card rendering. Each stock gets a per-symbol PNG and the site
// has one shared "generic" card for non-ticker pages. Static-only — runs
// during `astro build`, no runtime dependency.
//
// Two exports:
//   renderStockCardPng(symbol)  → PNG bytes for /og/{symbol}.png
//   renderGenericCardPng()       → PNG bytes for /og.png
//
// All values displayed are evergreen (no specific upcoming dates) so social
// platforms caching the image once won't show stale info months later.

import { readFile } from "node:fs/promises";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

import dividendsData from "../../data/set-dividends.json";
import companiesData from "../../data/companies.json";
import { todayIso, type DividendEvent, type Company } from "./dividends";

const dividends = dividendsData as DividendEvent[];
const companies = companiesData as Company[];

// ─── Palette (matches the site's light theme tokens) ───────────────────
const COLORS = {
  bg: "#faf5e9",
  ink: "#1a1d24",
  muted: "#5e636e",
  faint: "#9a9eaa",
  accent: "#b56627",
};

// ─── Industry / sector → human label ───────────────────────────────────
const INDUSTRY_LABELS: Record<string, string> = {
  AGRO: "Agro & Food",
  CONSUMP: "Consumer",
  FINCIAL: "Financials",
  INDUS: "Industrials",
  PROPCON: "Property",
  RESOURC: "Resources",
  SERVICE: "Services",
  TECH: "Technology",
};
const SECTOR_LABELS: Record<string, string> = {
  "PF&REIT": "REIT",
  ENERG: "Energy",
  TRANS: "Transport",
  CONS: "Construction",
  CONMAT: "Materials",
  PETRO: "Petrochem",
  PERSON: "Personal",
  PROF: "Professional",
  HELTH: "Health",
  HOME: "Home",
  PKG: "Packaging",
  INSUR: "Insurance",
  ETRON: "Electronics",
  TOURISM: "Tourism",
  AGRI: "Agribusiness",
  AUTO: "Automotive",
  FASHION: "Fashion",
  FIN: "Finance",
  IMM: "Investment",
  STEEL: "Steel",
  PAPER: "Paper",
  MEDIA: "Media",
  COMM: "Commerce",
  FOOD: "Food",
  BANK: "Bank",
};

function formatTag(c: Company | undefined | null): string | null {
  if (!c) return null;
  if (c.isIFF) return "Infrastructure Fund";
  if (c.sector) return SECTOR_LABELS[c.sector] ?? c.sector;
  if (c.industry) return INDUSTRY_LABELS[c.industry] ?? c.industry;
  return null;
}

// ─── Fonts: read once and reused across every card ─────────────────────
type FontEntry = { name: string; data: ArrayBuffer; weight: 300 | 500 | 600 | 700; style: "normal" | "italic" };
let _fontsPromise: Promise<FontEntry[]> | null = null;
function loadFonts(): Promise<FontEntry[]> {
  if (_fontsPromise) return _fontsPromise;
  _fontsPromise = (async () => {
    const [geist500, geist700, fraunces600, fraunces300i] = await Promise.all([
      readFile("node_modules/@fontsource/geist-sans/files/geist-sans-latin-500-normal.woff"),
      readFile("node_modules/@fontsource/geist-sans/files/geist-sans-latin-700-normal.woff"),
      readFile("node_modules/@fontsource/fraunces/files/fraunces-latin-600-normal.woff"),
      readFile("node_modules/@fontsource/fraunces/files/fraunces-latin-300-italic.woff"),
    ]);
    return [
      { name: "Geist", data: geist500.buffer.slice(geist500.byteOffset, geist500.byteOffset + geist500.byteLength), weight: 500, style: "normal" },
      { name: "Geist", data: geist700.buffer.slice(geist700.byteOffset, geist700.byteOffset + geist700.byteLength), weight: 700, style: "normal" },
      { name: "Fraunces", data: fraunces600.buffer.slice(fraunces600.byteOffset, fraunces600.byteOffset + fraunces600.byteLength), weight: 600, style: "normal" },
      { name: "Fraunces", data: fraunces300i.buffer.slice(fraunces300i.byteOffset, fraunces300i.byteOffset + fraunces300i.byteLength), weight: 300, style: "italic" },
    ];
  })();
  return _fontsPromise;
}

// ─── Tiny JSX helper (avoids pulling React in just for the tree) ───────
function el(type: string, props: Record<string, unknown>, children?: unknown): unknown {
  return { type, props: { ...props, children } };
}

// ─── Reusable masthead lockup with the brand mark ──────────────────────
function brandLockup(rightSlot: unknown): unknown {
  return el("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottom: `2px solid ${COLORS.ink}`,
      paddingBottom: 16,
      color: COLORS.ink,
    },
  }, [
    el("div", { style: { display: "flex", alignItems: "center", gap: 16 } }, [
      // Logo: three stacked rounded bars from public/favicon.svg
      el("div", { style: { display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" } }, [
        el("div", { style: { display: "flex", width: 20, height: 7, background: COLORS.ink, opacity: 0.35, borderRadius: 4 } }),
        el("div", { style: { display: "flex", width: 32, height: 7, background: COLORS.ink, opacity: 0.6, borderRadius: 4 } }),
        el("div", { style: { display: "flex", width: 48, height: 7, background: COLORS.accent, borderRadius: 4 } }),
      ]),
      // Brand mark — Fraunces, italic light + semibold (matches home page).
      el("div", { style: { display: "flex", alignItems: "baseline", gap: 8, fontFamily: "Fraunces" } }, [
        el("span", { style: { display: "flex", fontStyle: "italic", fontWeight: 300, fontSize: 26, color: COLORS.ink } }, "Thai Dividends"),
        el("span", { style: { display: "flex", fontWeight: 600, fontSize: 26, color: COLORS.ink } }, "Calendar"),
      ]),
      el("span", { style: { display: "flex", color: COLORS.faint, fontSize: 18, fontFamily: "Fraunces" } }, "·"),
      el("span", { style: { display: "flex", fontStyle: "italic", fontFamily: "Fraunces", fontSize: 18, color: COLORS.muted } }, "vol. 01"),
    ]),
    rightSlot,
  ]);
}

// ─── Stock card ────────────────────────────────────────────────────────
type StockProps = {
  symbol: string;
  companyName: string | null;
  tagLabel: string | null;
  variant: "recent" | "dormant";
  ttmAmount: string | null;
  lastPaidAmount: string | null;
  lastPaidYear: string | null;
  cadenceLabel: string | null;
  totalEvents: number;
  trackedSince: string | null;
};

function pickStockProps(symbol: string): StockProps {
  const events = dividends
    .filter((e) => e.symbol === symbol)
    .sort((a, b) => b.exDate.localeCompare(a.exDate));
  const company = companies.find((c) => c.symbol === symbol);

  const fmtAmount = (n: number) =>
    `฿${n.toFixed(4).replace(/(\.\d{2})0+$/, "$1")}`;

  const today = todayIso();
  const cutoff = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const last12 = events.filter(
    (e) => typeof e.amount === "number" && e.exDate >= cutoff && e.exDate <= today,
  );
  const ttmTotal = last12.reduce((s, e) => s + (e.amount as number), 0);
  const ttmCount = last12.length;
  const ttmAmount = ttmCount > 0 ? fmtAmount(ttmTotal) : null;

  const cadenceLabel = (() => {
    const confirmed = events.filter((e) => typeof e.amount === "number");
    if (confirmed.length < 2) return null;
    const years = new Set(confirmed.map((e) => e.exDate.slice(0, 4)));
    const yearCount = years.size;
    if (yearCount === 0) return null;
    const perYear = confirmed.length / yearCount;
    if (perYear >= 3.5) return "Quarterly";
    if (perYear >= 1.7) return "Semi-annually";
    if (perYear >= 0.8) return "Annually";
    return "Irregular";
  })();

  const trackedSince = events.length > 0
    ? events[events.length - 1].exDate.slice(0, 4)
    : null;

  const lastConfirmed = events.find((e) => typeof e.amount === "number");
  const lastPaidAmount = lastConfirmed ? fmtAmount(lastConfirmed.amount as number) : null;
  const lastPaidYear = lastConfirmed
    ? (lastConfirmed.paymentDate ?? lastConfirmed.exDate).slice(0, 4)
    : null;

  return {
    symbol,
    companyName: company?.name ?? null,
    tagLabel: formatTag(company),
    variant: ttmCount > 0 ? "recent" : "dormant",
    ttmAmount,
    lastPaidAmount,
    lastPaidYear,
    cadenceLabel,
    totalEvents: events.filter((e) => typeof e.amount === "number").length,
    trackedSince,
  };
}

function buildStockTree(p: StockProps): unknown {
  return el("div", {
    style: {
      width: 1200,
      height: 630,
      background: COLORS.bg,
      color: COLORS.ink,
      display: "flex",
      flexDirection: "column",
      padding: "44px 60px 40px",
      fontFamily: "Geist",
    },
  }, [
    brandLockup(
      p.tagLabel
        ? el("span", {
            style: {
              display: "flex",
              color: COLORS.accent,
              fontWeight: 600,
              letterSpacing: 3,
              fontSize: 14,
              textTransform: "uppercase",
            },
          }, p.tagLabel)
        : el("span", {
            style: {
              display: "flex",
              color: COLORS.faint,
              fontStyle: "italic",
              fontFamily: "Fraunces",
              fontSize: 16,
            },
          }, "listed"),
    ),

    // Ticker block
    el("div", { style: { display: "flex", flexDirection: "column", marginTop: 36 } }, [
      el("div", {
        style: {
          fontFamily: "Fraunces",
          fontSize: 220,
          fontWeight: 600,
          lineHeight: 0.9,
          letterSpacing: -4,
          color: COLORS.ink,
          display: "flex",
        },
      }, p.symbol),
      p.companyName ? el("div", {
        style: {
          fontFamily: "Fraunces",
          fontStyle: "italic",
          fontWeight: 300,
          fontSize: 30,
          lineHeight: 1.15,
          color: COLORS.muted,
          marginTop: 18,
          display: "flex",
          maxWidth: 900,
        },
      }, p.companyName) : null,
    ]),

    // Bottom: metric block + CTA pin
    el("div", {
      style: {
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        marginTop: "auto",
        paddingTop: 20,
      },
    }, [
      el("div", {
        style: {
          display: "flex",
          flexDirection: "column",
          borderLeft: `4px solid ${COLORS.accent}`,
          paddingLeft: 18,
          gap: 4,
        },
      }, [
        el("span", {
          style: {
            display: "flex",
            fontSize: 13,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: COLORS.muted,
            fontWeight: 600,
          },
        }, p.variant === "recent" ? "Last 12 months" : "Last paid"),
        p.variant === "recent" && p.ttmAmount
          ? el("div", { style: { display: "flex", alignItems: "baseline", gap: 10 } }, [
              el("span", { style: { display: "flex", fontFamily: "Fraunces", fontWeight: 600, fontSize: 64, color: COLORS.accent, lineHeight: 1 } }, p.ttmAmount),
              el("span", { style: { display: "flex", fontFamily: "Fraunces", fontStyle: "italic", fontSize: 24, color: COLORS.muted, fontWeight: 300 } }, "per share"),
            ])
          : p.lastPaidAmount && p.lastPaidYear
          ? el("div", { style: { display: "flex", alignItems: "baseline", gap: 10 } }, [
              el("span", { style: { display: "flex", fontFamily: "Fraunces", fontWeight: 600, fontSize: 64, color: COLORS.accent, lineHeight: 1 } }, p.lastPaidAmount),
              el("span", { style: { display: "flex", fontFamily: "Fraunces", fontStyle: "italic", fontSize: 24, color: COLORS.muted, fontWeight: 300 } }, `in ${p.lastPaidYear}`),
            ])
          : el("span", {
              style: {
                display: "flex",
                fontFamily: "Fraunces",
                fontStyle: "italic",
                fontSize: 36,
                color: COLORS.faint,
                fontWeight: 300,
              },
            }, "no dividend history"),
        el("span", {
          style: {
            display: "flex",
            fontSize: 16,
            color: COLORS.muted,
            marginTop: 4,
          },
        }, [
          p.cadenceLabel ? `${p.cadenceLabel} · ` : "",
          `${p.totalEvents} dividend${p.totalEvents === 1 ? "" : "s"}`,
          p.trackedSince ? ` · since ${p.trackedSince}` : "",
        ].join("")),
      ]),

      el("span", {
        style: {
          display: "flex",
          fontFamily: "Fraunces",
          fontStyle: "italic",
          fontSize: 22,
          color: COLORS.muted,
        },
      }, `Track ${p.symbol} →`),
    ]),
  ]);
}

// ─── Generic card ──────────────────────────────────────────────────────
type GenericProps = {
  totalTickers: number;
  totalEvents: number;
  trackedSince: string;
};

function pickGenericProps(): GenericProps {
  const confirmed = dividends.filter((e) => typeof e.amount === "number");
  const years = dividends.map((e) => e.exDate.slice(0, 4)).sort();
  return {
    totalTickers: companies.length,
    totalEvents: confirmed.length,
    trackedSince: years[0] ?? "2016",
  };
}

function buildGenericTree(p: GenericProps): unknown {
  const fmtNum = (n: number) => n.toLocaleString("en-US");
  return el("div", {
    style: {
      width: 1200,
      height: 630,
      background: COLORS.bg,
      color: COLORS.ink,
      display: "flex",
      flexDirection: "column",
      padding: "44px 60px 40px",
      fontFamily: "Geist",
    },
  }, [
    brandLockup(
      el("span", {
        style: {
          display: "flex",
          fontFamily: "Fraunces",
          fontStyle: "italic",
          fontSize: 18,
          color: COLORS.muted,
        },
      }, "The Daily Ledger"),
    ),

    // Hero — full brand mark blown up.
    el("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        marginTop: 36,
        fontFamily: "Fraunces",
        lineHeight: 0.92,
        letterSpacing: -2,
      },
    }, [
      el("span", { style: { display: "flex", fontStyle: "italic", fontWeight: 300, fontSize: 132, color: COLORS.ink } }, "Thai Dividends"),
      el("span", { style: { display: "flex", fontWeight: 600, fontSize: 132, color: COLORS.ink, marginTop: 4 } }, "Calendar"),
    ]),

    el("span", {
      style: {
        display: "flex",
        fontFamily: "Fraunces",
        fontStyle: "italic",
        fontWeight: 300,
        fontSize: 28,
        color: COLORS.muted,
        marginTop: 24,
        maxWidth: 900,
      },
    }, "Ex-dividend & payment dates for SET-listed stocks."),

    el("div", {
      style: {
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        marginTop: "auto",
        paddingTop: 20,
      },
    }, [
      el("div", {
        style: {
          display: "flex",
          flexDirection: "column",
          borderLeft: `4px solid ${COLORS.accent}`,
          paddingLeft: 18,
          gap: 4,
        },
      }, [
        el("span", { style: { display: "flex", fontSize: 13, letterSpacing: 4, textTransform: "uppercase", color: COLORS.muted, fontWeight: 600 } }, "Tracking"),
        el("span", { style: { display: "flex", fontFamily: "Fraunces", fontWeight: 600, fontSize: 40, color: COLORS.ink, lineHeight: 1 } }, `${fmtNum(p.totalTickers)} symbols`),
        el("span", { style: { display: "flex", fontSize: 16, color: COLORS.muted, marginTop: 4 } }, `${fmtNum(p.totalEvents)} dividends · since ${p.trackedSince}`),
      ]),
      el("span", {
        style: {
          display: "flex",
          fontFamily: "Fraunces",
          fontStyle: "italic",
          fontSize: 22,
          color: COLORS.muted,
        },
      }, "Browse the calendar →"),
    ]),
  ]);
}

// ─── Render driver ─────────────────────────────────────────────────────
async function renderTreeToPng(tree: unknown): Promise<Uint8Array> {
  const fonts = await loadFonts();
  const svg = await satori(tree as never, {
    width: 1200,
    height: 630,
    fonts: fonts.map((f) => ({
      name: f.name,
      data: f.data,
      weight: f.weight,
      style: f.style,
    })),
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: 1200 } })
    .render()
    .asPng();
}

export async function renderStockCardPng(symbol: string): Promise<Uint8Array> {
  return renderTreeToPng(buildStockTree(pickStockProps(symbol)));
}

export async function renderGenericCardPng(): Promise<Uint8Array> {
  return renderTreeToPng(buildGenericTree(pickGenericProps()));
}

// Convenience metadata used to construct og:title / og:description per stock.
export function getStockOgMeta(symbol: string): {
  title: string;
  description: string;
} {
  const company = companies.find((c) => c.symbol === symbol);
  const name = company?.name ?? symbol;
  return {
    title: `${symbol} — Thai Dividends Calendar`,
    description: `Dividend history & payment schedule for ${symbol}${company ? ` (${name})` : ""}.`,
  };
}
