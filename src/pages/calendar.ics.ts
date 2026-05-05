import type { APIRoute } from "astro";
import { loadEvents, todayIso } from "../lib/dividends";
import { buildIcs } from "../lib/ical";
import { eventsToIcsEvents } from "../lib/ical-feed";

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const siteUrl = (site?.toString() ?? "https://kidchenko.github.io/").replace(/\/$/, "");
  const basePath = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  const events = loadEvents();
  const icsEvents = eventsToIcsEvents(events, {
    siteUrl,
    basePath,
    cutoffIso: todayIso(),
  });
  const body = buildIcs({
    name: "Thai Dividends — All upcoming",
    description:
      "Upcoming ex-dividend & payment dates for SET-listed stocks. Updates automatically.",
    events: icsEvents,
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
