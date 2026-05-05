import type { APIRoute } from "astro";
import {
  getCompany,
  getEventsForSymbol,
  getStockListings,
} from "../../lib/dividends";
import { buildIcs } from "../../lib/ical";
import { eventsToIcsEvents } from "../../lib/ical-feed";

export const prerender = true;

export async function getStaticPaths() {
  // Only publish feeds for symbols with at least one dividend event on file.
  return getStockListings()
    .filter((s) => s.eventCount > 0)
    .map((s) => ({ params: { symbol: s.symbol } }));
}

export const GET: APIRoute = ({ params, site }) => {
  const symbol = String(params.symbol ?? "");
  const events = getEventsForSymbol(symbol);
  const company = getCompany(symbol);
  const siteUrl = (site?.toString() ?? "https://kidchenko.github.io/").replace(/\/$/, "");
  const basePath = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  const icsEvents = eventsToIcsEvents(events, { siteUrl, basePath });
  const body = buildIcs({
    name: `Thai Dividends — ${symbol}`,
    description: company?.name ?? `Dividend events for ${symbol}`,
    events: icsEvents,
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
