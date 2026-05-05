import type { APIRoute } from "astro";
import { getStockListings } from "../../lib/dividends";
import { renderStockCardPng } from "../../lib/og";

export const prerender = true;

// Per-symbol OG generation is the slow part of the build (~150s for 1148
// PNGs). Gate it behind BUILD_OG=1 so day-to-day local builds finish in
// seconds; CI / production deploy sets the flag to emit the full set.
const BUILD_OG = process.env.BUILD_OG === "1";

export async function getStaticPaths() {
  if (!BUILD_OG) return [];
  return getStockListings().map((s) => ({ params: { symbol: s.symbol } }));
}

export const GET: APIRoute = async ({ params }) => {
  const symbol = String(params.symbol ?? "");
  const png = await renderStockCardPng(symbol);
  return new Response(png as unknown as BodyInit, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
};
