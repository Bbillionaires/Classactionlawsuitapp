const BASE_URL =
  process.env.COURTLISTENER_API_BASE_URL ??
  "https://www.courtlistener.com/api/rest/v4";

function authHeaders(): Record<string, string> {
  const token = process.env.COURTLISTENER_API_TOKEN;
  if (!token) throw new Error("COURTLISTENER_API_TOKEN is not set");
  return { Authorization: `Token ${token}` };
}

/**
 * This CourtListener token is shared with the live web app and throttled
 * to 5 requests/min account-wide. The worker runs in the background with
 * no user waiting on it, so it should never compete for that budget —
 * space every call out generously and leave headroom for real visitors.
 */
const MIN_MS_BETWEEN_CALLS = 20_000; // 3 req/min for this worker, max
let lastCallAt = 0;

async function throttledFetch(url: string): Promise<Response> {
  const wait = lastCallAt + MIN_MS_BETWEEN_CALLS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCallAt = Date.now();

  const response = await fetch(url, { headers: authHeaders() });
  if (response.status === 429) {
    // Someone else (the live site) is using the shared budget right now.
    // Back off well beyond our own spacing and try once more.
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    lastCallAt = Date.now();
    return fetch(url, { headers: authHeaders() });
  }
  return response;
}

export interface RecapDocket {
  docket_id: number;
  caseName: string;
  court_id: string;
  docketNumber: string | null;
  dateFiled: string | null;
  dateTerminated: string | null;
}

interface RawSearchResponse {
  count: number;
  results: RecapDocket[];
}

/**
 * Dockets likely to actually be near a settlement, for the worker's
 * watchlist.
 *
 * This deliberately does NOT sort by newest-filed: a docket's dateFiled
 * is when the *case* was opened, and settlements typically emerge months
 * or years later. Sorting by dateFiled desc only ever samples brand-new
 * filings, which structurally can't have a settlement yet — that was
 * this worker's original (wrong) strategy, and it explains why weeks of
 * runs never turned up a single candidate. Instead this searches RECAP's
 * full text for class-action dockets whose own docket/entry text already
 * mentions settlement language, so relevance ranking naturally surfaces
 * cases actually at that stage regardless of filing date.
 */
export async function fetchLikelySettlementDockets(
  limit: number,
): Promise<RecapDocket[]> {
  const settlementQuery = [
    "preliminary approval",
    "final approval",
    "settlement administrator",
    "claims administrator",
    "notice of settlement",
    "class action settlement",
  ]
    .map((phrase) => `"${phrase}"`)
    .join(" OR ");

  const params = new URLSearchParams({
    type: "r",
    q: `"class action" AND (${settlementQuery})`,
  });
  const response = await throttledFetch(
    `${BASE_URL}/search/?${params.toString()}`,
  );
  if (!response.ok) {
    throw new Error(`CourtListener search failed: ${response.status}`);
  }
  const raw = (await response.json()) as RawSearchResponse;
  return raw.results.slice(0, limit);
}

// CourtListener and a lead source can each format the same docket number
// differently (e.g. with or without a trailing judge-initials suffix) -
// comparing just the "<office>:<yy>-<type>-<number>" core avoids a false
// mismatch on that, without loosening the check enough to match a
// different case entirely.
function normalizeDocketNumber(raw: string): string {
  const core = raw.match(/\d{1,2}:\d{2}-[a-z]{2}-\d{3,6}/i);
  return (core ? core[0] : raw).toLowerCase().replace(/[^a-z0-9]/g, "");
}

const CASE_NAME_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "from",
  "with",
  "inc",
  "llc",
  "corp",
  "corporation",
  "company",
  "co",
  "et",
  "al",
]);

function distinctiveTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !CASE_NAME_STOPWORDS.has(word)),
  );
}

// A real match (the same case, captioned slightly differently - a fuller
// defendant name, "Corp" vs "Corporation") contains essentially all of
// the smaller side's distinctive words in the other, not just most of
// them: a flat overlap score over the whole caption lets two *different*
// cases against the same common defendant (e.g. "Franks v. Marks" and
// "Rederick v. Marks") pass on the shared surname alone, which is
// exactly the kind of mismatch this check exists to catch.
function sideLikelyMatches(a: string, b: string): boolean {
  const tokensA = distinctiveTokens(a);
  const tokensB = distinctiveTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared += 1;
  return shared === Math.min(tokensA.size, tokensB.size);
}

const CAPTION_SEPARATOR = /\s+v\.?s?\.?\s+/i;

/** Splits a "Plaintiff v. Defendant" caption in two, or null if it doesn't fit that shape. */
function splitCaption(name: string): [string, string] | null {
  const parts = name.split(CAPTION_SEPARATOR);
  return parts.length === 2 ? [parts[0], parts[1]] : null;
}

function caseNamesLikelyMatch(a: string, b: string): boolean {
  const splitA = splitCaption(a);
  const splitB = splitCaption(b);
  if (splitA && splitB) {
    // Compare plaintiff-side to plaintiff-side and defendant-side to
    // defendant-side, so a shared defendant alone can't carry a match.
    return (
      sideLikelyMatches(splitA[0], splitB[0]) &&
      sideLikelyMatches(splitA[1], splitB[1])
    );
  }
  // Couldn't confidently split one of the captions into plaintiff/
  // defendant (an unusual caption shape) - fall back to requiring the
  // smaller side's words all appear in the other, rather than guessing
  // from a partial match.
  return sideLikelyMatches(a, b);
}

async function searchFirstDocket(query: string): Promise<RecapDocket | null> {
  const searchParams = new URLSearchParams({ type: "r", q: query });
  const response = await throttledFetch(
    `${BASE_URL}/search/?${searchParams.toString()}`,
  );
  if (!response.ok) return null;
  const raw = (await response.json()) as RawSearchResponse;
  return raw.results[0] ?? null;
}

/**
 * Finds the CourtListener docket for a case identified elsewhere (e.g. by
 * a lead from a secondary settlement-tracking source) — tried by docket
 * number first, since that's an exact identifier, falling back to a case
 * name search. Docket *metadata* (parties, court, filing date) is public
 * and in CourtListener's index even when the actual filed documents are
 * paywalled and never mirrored to RECAP, so this reliably finds the
 * docket to link to even for cases our own document-text search
 * (fetchLikelySettlementDockets) would never surface.
 *
 * CourtListener's search is free-text, not an exact-field lookup, so the
 * top result isn't guaranteed to actually be the case being searched for
 * (e.g. a docket-number search with no exact hit, or a case-name search
 * matching an unrelated suit against a common defendant). Each candidate
 * is verified against the identifier that found it before being accepted
 * - an unverified match is treated the same as no match, consistent with
 * this pipeline never publishing an unverified link.
 */
export async function findDocketByCaseIdentifier(params: {
  docketNumber: string | null;
  caseName: string | null;
}): Promise<RecapDocket | null> {
  if (params.docketNumber?.trim()) {
    const candidate = await searchFirstDocket(params.docketNumber);
    if (
      candidate?.docketNumber &&
      normalizeDocketNumber(candidate.docketNumber) ===
        normalizeDocketNumber(params.docketNumber)
    ) {
      return candidate;
    }
  }

  if (params.caseName?.trim()) {
    const candidate = await searchFirstDocket(params.caseName);
    if (candidate && caseNamesLikelyMatch(candidate.caseName, params.caseName)) {
      return candidate;
    }
  }

  return null;
}

export interface RecapDocument {
  id: number;
  description: string;
  is_available: boolean;
  plain_text?: string;
  absolute_url: string;
}

export interface DocketEntry {
  id: number;
  entry_number: number | null;
  date_filed: string | null;
  description: string;
  recap_documents: RecapDocument[];
}

interface RawDocketEntriesResponse {
  results: DocketEntry[];
}

export async function fetchDocketEntries(
  docketId: number,
): Promise<DocketEntry[]> {
  const params = new URLSearchParams({
    docket: String(docketId),
    order_by: "-recap_sequence_number",
  });
  const response = await throttledFetch(
    `${BASE_URL}/docket-entries/?${params.toString()}`,
  );
  if (!response.ok) {
    throw new Error(
      `CourtListener docket-entries failed for docket ${docketId}: ${response.status}`,
    );
  }
  const raw = (await response.json()) as RawDocketEntriesResponse;
  return raw.results;
}

/**
 * Fetches a single recap document's full text. Many settlement-relevant
 * documents are NOT `is_available` (behind PACER's paywall, never
 * mirrored to RECAP) — this returns null in that case rather than
 * guessing at content that isn't there.
 */
export async function fetchDocumentPlainText(
  documentId: number,
): Promise<string | null> {
  const response = await throttledFetch(
    `${BASE_URL}/recap-documents/${documentId}/`,
  );
  if (!response.ok) return null;
  const doc = (await response.json()) as RecapDocument;
  return doc.plain_text ?? null;
}
