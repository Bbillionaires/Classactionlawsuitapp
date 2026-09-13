import * as cheerio from "cheerio";

/**
 * Secondary discovery source: Top Class Actions' public "open settlements"
 * listing. Per the project's design rule, an aggregator like this is only
 * ever a LEAD source — it tells us a settlement exists and points at
 * fields to check, but every fact we publish still goes through the same
 * verification/confidence pipeline as everything found directly in court
 * records (see discoverFromAggregator.ts).
 *
 * The site sits behind Cloudflare's bot check, which blocks Node's fetch
 * outright (a plain identifying User-Agent gets a 403 JS-challenge page,
 * confirmed while building this) unless the request looks like a real
 * browser. Presenting a Chrome User-Agent + Accept headers here is a
 * deliberate choice to get past that check, made explicitly at the
 * project owner's direction, not a default we'd reach for quietly.
 * robots.txt does not disallow these paths; requests are still spaced
 * out to stay a low-volume, infrequent reader.
 */
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};
const LISTING_URL =
  "https://topclassactions.com/category/lawsuit-settlements/open-lawsuit-settlements/";
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

/** Detail-page URLs from the listing page, in the order they appear. */
export async function fetchOpenSettlementLeadUrls(
  limit: number,
): Promise<string[]> {
  const html = await politeFetch(LISTING_URL);
  if (!html) return [];

  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const urls: string[] = [];

  $('a[href*="/lawsuit-settlements/open-lawsuit-settlements/"]').each((_, el) => {
    if (urls.length >= limit) return;
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    // The listing links to each detail page 2-3 times (image, title,
    // "submit a claim" button) — only the ones with real title/button
    // text are useful signal; skip the bare image wrapper and dedupe.
    if (!href || !text || href === LISTING_URL) return;
    if (seen.has(href)) return;
    seen.add(href);
    urls.push(href);
  });

  return urls;
}

export interface AggregatorLead {
  sourceUrl: string;
  title: string | null;
  caseName: string | null;
  docketNumber: string | null;
  court: string | null;
  classDefinition: string | null;
  potentialAward: string | null;
  proofRequired: string | null;
  exclusionDeadline: string | null;
  finalHearingDate: string | null;
  settlementWebsiteUrl: string | null;
  claimFormUrl: string | null;
  administratorText: string | null;
}

function valueColumnFor(
  $: cheerio.CheerioAPI,
  heading: ReturnType<cheerio.CheerioAPI>,
): ReturnType<cheerio.CheerioAPI> | null {
  if (heading.length === 0) return null;
  return heading.closest(".wp-block-column").next(".wp-block-column");
}

/** Text of the field value column following a given `h6#h-<id>` heading. */
function fieldText($: cheerio.CheerioAPI, headingId: string): string | null {
  const valueColumn = valueColumnFor($, $(`#${headingId}`));
  if (!valueColumn) return null;
  const text = valueColumn.text().replace(/\s+/g, " ").trim();
  return text || null;
}

/**
 * Same as fieldText, but for headings whose id isn't stable across pages
 * (TCA labels the deadline field differently depending on settlement
 * type — "Exclusion Deadline", "Exclusion and Objection Deadline",
 * "Claims Deadline", etc.). Tries each id-substring in order, first
 * match wins.
 */
function fieldTextByIdContains(
  $: cheerio.CheerioAPI,
  substrings: string[],
): string | null {
  for (const substring of substrings) {
    const heading = $(`h6[id*="${substring}"]`).first();
    const valueColumn = valueColumnFor($, heading);
    if (valueColumn) {
      const text = valueColumn.text().replace(/\s+/g, " ").trim();
      if (text) return text;
    }
  }
  return null;
}

function fieldLink($: cheerio.CheerioAPI, headingId: string): string | null {
  const heading = $(`#${headingId}`);
  if (heading.length === 0) return null;
  const valueColumn = heading.closest(".wp-block-column").next(".wp-block-column");
  const href = valueColumn.find("a").first().attr("href");
  return href || null;
}

function normalizeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).toString();
  } catch {
    // TCA occasionally omits the scheme (e.g. "Kohama2026Settlement.com").
    try {
      return new URL(`https://${raw}`).toString();
    } catch {
      return null;
    }
  }
}

/** Parses TCA's own structured fields for one settlement's detail page. */
export async function fetchLeadDetails(
  url: string,
): Promise<AggregatorLead | null> {
  const html = await politeFetch(url);
  if (!html) return null;

  const $ = cheerio.load(html);
  const caseNameBlock = fieldText($, "h-case-name");

  // TCA's "Case Name" field reads like:
  // "Kohama v. GEICO, Case No. 8:24-cv-00743-TDC, in the U.S. District
  // Court for the District of Maryland, Southern Division"
  let caseName: string | null = null;
  let docketNumber: string | null = null;
  let court: string | null = null;
  if (caseNameBlock) {
    const caseNoMatch = caseNameBlock.match(/Case No\.?\s*([A-Za-z0-9:.\-]+)/i);
    docketNumber = caseNoMatch ? caseNoMatch[1] : null;
    caseName = caseNoMatch
      ? caseNameBlock.slice(0, caseNoMatch.index).replace(/,\s*$/, "").trim()
      : caseNameBlock;
    const courtMatch = caseNameBlock.match(/in the (.+)$/i);
    court = courtMatch ? courtMatch[1].trim() : null;
  }

  return {
    sourceUrl: url,
    title: $("h1").first().text().trim() || null,
    caseName,
    docketNumber,
    court,
    classDefinition: fieldText($, "h-who-s-eligible"),
    potentialAward: fieldText($, "h-potential-award"),
    proofRequired: fieldText($, "h-proof-of-purchase"),
    exclusionDeadline: fieldTextByIdContains($, [
      "exclusion-deadline",
      "exclusion-and-objection-deadline",
      "claims-deadline",
      "objection-deadline",
      "deadline",
    ]),
    finalHearingDate: fieldText($, "h-final-hearing"),
    settlementWebsiteUrl: normalizeUrl(fieldLink($, "h-settlement-website")),
    claimFormUrl: normalizeUrl(fieldLink($, "h-claim-form")),
    administratorText: fieldText($, "h-claims-administrator"),
  };
}
