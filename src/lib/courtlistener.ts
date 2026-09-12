import "server-only";

const DEFAULT_BASE_URL = "https://www.courtlistener.com/api/rest/v4";

export class CourtListenerConfigError extends Error {}

export class CourtListenerApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "CourtListenerApiError";
  }
}

function getBaseUrl(): string {
  return process.env.COURTLISTENER_API_BASE_URL ?? DEFAULT_BASE_URL;
}

function getAuthHeaders(): HeadersInit {
  const token = process.env.COURTLISTENER_API_TOKEN;
  if (!token) {
    throw new CourtListenerConfigError(
      "COURTLISTENER_API_TOKEN is not set. Add it to your .env.local (see .env.example).",
    );
  }
  return {
    Authorization: `Token ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * A single federal docket returned by CourtListener's RECAP search
 * (search type "r"). Only the fields this app currently uses are typed;
 * the API returns many more.
 */
export interface CourtListenerDocket {
  docket_id: number;
  caseName: string;
  court: string;
  court_id: string;
  docketNumber: string | null;
  dateFiled: string | null;
  dateTerminated: string | null;
  cause: string | null;
  assignedTo: string | null;
  party: string[];
  docket_absolute_url: string;
}

/** A search result page, with opaque cursors instead of raw CourtListener URLs. */
export interface CourtListenerSearchPage {
  count: number;
  nextCursor: string | null;
  previousCursor: string | null;
  results: CourtListenerDocket[];
}

export type CourtListenerSortOrder = "relevance" | "newest" | "oldest";

const ORDER_BY: Record<CourtListenerSortOrder, string | null> = {
  relevance: null,
  newest: "dateFiled desc",
  oldest: "dateFiled asc",
};

export interface SearchClassActionCasesParams {
  /** Free-text search query, e.g. "data breach class action". */
  query: string;
  /** Restrict results to a specific court ID, e.g. "cand" for N.D. Cal. */
  courtId?: string;
  /** Only cases filed on or after this date (YYYY-MM-DD). */
  filedAfter?: string;
  /** Only cases filed on or before this date (YYYY-MM-DD). */
  filedBefore?: string;
  /** Page cursor from a previous result's `nextCursor`/`previousCursor`. */
  cursor?: string;
  /** Result order. Defaults to CourtListener's relevance ranking. */
  sort?: CourtListenerSortOrder;
}

/** Pulls the opaque `cursor` query param out of a CourtListener pagination URL. */
function extractCursor(paginationUrl: string | null): string | null {
  if (!paginationUrl) return null;
  try {
    return new URL(paginationUrl).searchParams.get("cursor");
  } catch {
    return null;
  }
}

interface RawSearchResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: CourtListenerDocket[];
}

/**
 * Searches federal court dockets (RECAP, search type "r") for class action
 * cases via CourtListener's REST API.
 */
export async function searchClassActionCases(
  params: SearchClassActionCasesParams,
): Promise<CourtListenerSearchPage> {
  const { query, courtId, filedAfter, filedBefore, cursor, sort } = params;

  const searchParams = new URLSearchParams({
    type: "r",
    q: query ? `${query} class action` : "class action",
  });
  if (courtId) searchParams.set("court", courtId);
  if (filedAfter) searchParams.set("filed_after", filedAfter);
  if (filedBefore) searchParams.set("filed_before", filedBefore);
  if (cursor) searchParams.set("cursor", cursor);
  const orderBy = sort ? ORDER_BY[sort] : null;
  if (orderBy) searchParams.set("order_by", orderBy);

  const url = `${getBaseUrl()}/search/?${searchParams.toString()}`;

  const response = await fetch(url, {
    headers: getAuthHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new CourtListenerApiError(
      `CourtListener search failed (${response.status}): ${body || response.statusText}`,
      response.status,
    );
  }

  const raw = (await response.json()) as RawSearchResponse;
  return {
    count: raw.count,
    nextCursor: extractCursor(raw.next),
    previousCursor: extractCursor(raw.previous),
    results: raw.results,
  };
}

/** Full docket detail, as returned by `/dockets/{id}/`. */
export interface CourtListenerDocketDetail {
  id: number;
  case_name: string;
  court_id: string;
  docket_number: string | null;
  date_filed: string | null;
  date_terminated: string | null;
  date_last_filing: string | null;
  cause: string | null;
  nature_of_suit: string | null;
  assigned_to_str: string | null;
  referred_to_str: string | null;
  jury_demand: string | null;
  absolute_url: string;
}

export async function getDocketById(
  docketId: string,
): Promise<CourtListenerDocketDetail> {
  const url = `${getBaseUrl()}/dockets/${encodeURIComponent(docketId)}/`;

  const response = await fetch(url, {
    headers: getAuthHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new CourtListenerApiError(
      `CourtListener docket lookup failed (${response.status}): ${body || response.statusText}`,
      response.status,
    );
  }

  return (await response.json()) as CourtListenerDocketDetail;
}

export interface CourtListenerRecapDocument {
  id: number;
  description: string;
  page_count: number | null;
  absolute_url: string;
  filepath_ia: string | null;
  is_available: boolean;
}

export interface CourtListenerDocketEntry {
  id: number;
  date_filed: string | null;
  entry_number: number | null;
  description: string;
  recap_documents: CourtListenerRecapDocument[];
}

interface RawDocketEntriesResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: CourtListenerDocketEntry[];
}

/** Docket entries (the filing history) for a docket, most recent first. */
export async function getDocketEntries(
  docketId: string,
): Promise<CourtListenerDocketEntry[]> {
  const searchParams = new URLSearchParams({
    docket: docketId,
    order_by: "-recap_sequence_number",
  });
  const url = `${getBaseUrl()}/docket-entries/?${searchParams.toString()}`;

  const response = await fetch(url, {
    headers: getAuthHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new CourtListenerApiError(
      `CourtListener docket entries lookup failed (${response.status}): ${body || response.statusText}`,
      response.status,
    );
  }

  const raw = (await response.json()) as RawDocketEntriesResponse;
  return raw.results;
}
