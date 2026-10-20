import * as cheerio from "cheerio";
import type { AggregatorLead } from "./aggregator.js";

/**
 * Second lead source, same role as Top Class Actions (aggregator.ts): a
 * public settlement-tracking site used strictly for leads, never as ground
 * truth. Every fact it supplies still goes through the same
 * cross-reference-against-a-real-docket pipeline in discoverFromAggregator.ts.
 *
 * Unlike TCA, classaction.org's listing page embeds every settlement's
 * summary fields (name, deadline, payout, proof-required) directly as a
 * JSON blob in a `data-items` attribute - no per-lead detail page to visit,
 * no Cloudflare challenge encountered while building this. The listing does
 * NOT include a docket number or "Plaintiff v. Defendant" caption though
 * (just a marketing-style settlement title), so a docket number for these
 * leads is resolved later, best-effort, from the official settlement site's
 * own page text (see discoverFromAggregator.ts).
 */
const LISTING_URL = "https://www.classaction.org/settlements";
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};
const MIN_MS_BETWEEN_REQUESTS = 4_000;

let lastRequestAt = 0;

async function politeFetch(url: string): Promise<string | null> {
  const wait = lastRequestAt + MIN_MS_BETWEEN_REQUESTS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();

  const response = await fetch(url, { headers: BROWSER_HEADERS });
  if (!response.ok) return null;
  return response.text();
}

interface ListingItem {
  proof: string;
  slug: string;
  name: string;
  deadline: string;
  amount: string;
}

export async function fetchClassActionOrgLeads(
  limit: number,
): Promise<AggregatorLead[]> {
  const html = await politeFetch(LISTING_URL);
  if (!html) return [];

  const $ = cheerio.load(html);

  const itemsRaw = $(".view-list").attr("data-items");
  if (!itemsRaw) return [];

  let items: ListingItem[];
  try {
    items = JSON.parse(itemsRaw);
  } catch {
    return [];
  }

  // The official settlement URL isn't in the data-items JSON - it's only on
  // each card's own anchor tag, keyed by the same slug.
  const officialUrlBySlug = new Map<string, string>();
  $("a.js-settlement-link[data-slug]").each((_, el) => {
    const slug = $(el).attr("data-slug");
    const href = $(el).attr("href");
    if (slug && href && !officialUrlBySlug.has(slug)) {
      officialUrlBySlug.set(slug, href);
    }
  });

  const leads: AggregatorLead[] = [];
  for (const item of items) {
    if (leads.length >= limit) break;
    const officialUrl = officialUrlBySlug.get(item.slug);
    if (!officialUrl) continue;
    // Guard against a card linking back to classaction.org itself (e.g. a
    // malformed or placeholder entry) rather than a real external official
    // site - same spirit as aggregator.ts skipping TCA's own listing URL.
    try {
      const hostname = new URL(officialUrl).hostname.toLowerCase();
      if (hostname === "classaction.org" || hostname.endsWith(".classaction.org")) continue;
    } catch {
      continue;
    }

    leads.push({
      sourceUrl: `${LISTING_URL}#${item.slug}`,
      title: item.name || null,
      caseName: item.name || null,
      docketNumber: null,
      court: null,
      classDefinition: null,
      potentialAward: item.amount || null,
      proofRequired: item.proof || null,
      exclusionDeadline: item.deadline || null,
      finalHearingDate: null,
      settlementWebsiteUrl: officialUrl,
      claimFormUrl: null,
      administratorText: null,
    });
  }

  return leads;
}
