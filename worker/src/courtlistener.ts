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

/** The newest N federal class-action dockets, for the worker's watchlist. */
export async function fetchNewestClassActionDockets(
  limit: number,
): Promise<RecapDocket[]> {
  const params = new URLSearchParams({
    type: "r",
    q: "class action",
    order_by: "dateFiled desc",
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
