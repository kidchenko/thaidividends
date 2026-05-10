// Maps a Company's raw SET classification into the single filter bucket the
// directory UI cares about. REITs/Funds, ETFs, and DRs are treated as peers
// to SET industry tags - clicking one is the user's whole filter intent.

import type { Company } from "./dividends";

// SET's 8 industries. Order: financials and property first since they hold
// the most dividend-paying tickers Thai investors look up.
export const INDUSTRIES = [
  "FINCIAL",
  "PROPCON",
  "RESOURC",
  "SERVICE",
  "TECH",
  "INDUS",
  "AGRO",
  "CONSUMP",
] as const;

export type Industry = (typeof INDUSTRIES)[number];

// Cross-cutting instrument buckets surfaced as their own filter tags.
export const SPECIAL_TAGS = ["reit", "etf", "dr"] as const;
export type SpecialTag = (typeof SPECIAL_TAGS)[number];

export type FilterTag = Industry | SpecialTag | "_none";

// Order pills are rendered in. Industries first, then cross-cutting buckets.
export const FILTER_TAGS: FilterTag[] = [...INDUSTRIES, ...SPECIAL_TAGS];

export function isIndustry(s: unknown): s is Industry {
  return typeof s === "string" && (INDUSTRIES as readonly string[]).includes(s);
}

export function getFilterTag(c: Company): FilterTag {
  // Cross-cutting buckets win over industry - a REIT is a REIT to a Thai
  // investor first, "in the property industry" second.
  if (c.sector === "PF&REIT" || c.isIFF) return "reit";
  if (c.securityType === "L") return "etf";
  if (c.securityType === "X") return "dr";
  if (c.industry && isIndustry(c.industry)) return c.industry;
  return "_none"; // delisted/unmatched; visible only under "All".
}
