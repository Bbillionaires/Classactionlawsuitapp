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

export interface CourtListenerSearchResult {
  count: number;
  next: string | null;
  previous: string | null;
  results: CourtListenerDocket[];
}

export interface SearchClassActionCasesParams {
  /** Free-text search query, e.g. "data breach class action". */
  query: string;
  /** Restrict results to a specific court ID, e.g. "cand" for N.D. Cal. */
  courtId?: string;
  /** Only cases filed on or after this date (YYYY-MM-DD). */
  filedAfter?: string;
  /** Only cases filed on or before this date (YYYY-MM-DD). */
  filedBefore?: string;
  /** Page cursor from a previous response's `next`/`previous` field. */
  cursor?: string;
}

/**
 * Searches federal court dockets (RECAP, search type "r") for class action
 * cases via CourtListener's REST API.
 */
export async function searchClassActionCases(
  params: SearchClassActionCasesParams,
): Promise<CourtListenerSearchResult> {
  const { query, courtId, filedAfter, filedBefore, cursor } = params;

  const searchParams = new URLSearchParams({
    type: "r",
    q: query ? `${query} class action` : "class action",
  });
  if (courtId) searchParams.set("court", courtId);
  if (filedAfter) searchParams.set("filed_after", filedAfter);
  if (filedBefore) searchParams.set("filed_before", filedBefore);
  if (cursor) searchParams.set("cursor", cursor);

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

  return (await response.json()) as CourtListenerSearchResult;
}
