import type { APIRoute } from "astro";
import { renderGenericCardPng } from "../lib/og";

export const prerender = true;

export const GET: APIRoute = async () => {
  const png = await renderGenericCardPng();
  return new Response(png as unknown as BodyInit, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
};
