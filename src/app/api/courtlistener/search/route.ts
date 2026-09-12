import { NextRequest, NextResponse } from "next/server";
import {
  CourtListenerApiError,
  CourtListenerConfigError,
  type CourtListenerSortOrder,
  searchClassActionCases,
} from "@/lib/courtlistener";

const VALID_SORTS: CourtListenerSortOrder[] = ["relevance", "newest", "oldest"];

function parseSort(value: string | null): CourtListenerSortOrder | undefined {
  return VALID_SORTS.includes(value as CourtListenerSortOrder)
    ? (value as CourtListenerSortOrder)
    : undefined;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = params.get("q")?.trim() ?? "";
  const courtId = params.get("court")?.trim() || undefined;
  const filedAfter = params.get("filed_after")?.trim() || undefined;
  const filedBefore = params.get("filed_before")?.trim() || undefined;
  const cause = params.get("cause")?.trim() || undefined;
  const cursor = params.get("cursor")?.trim() || undefined;
  const sort = parseSort(params.get("sort"));

  try {
    const results = await searchClassActionCases({
      query,
      courtId,
      filedAfter,
      filedBefore,
      cause,
      cursor,
      sort,
    });
    return NextResponse.json(results);
  } catch (error) {
    if (error instanceof CourtListenerConfigError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (error instanceof CourtListenerApiError) {
      if (error.status === 429) {
        return NextResponse.json(
          { error: "CourtListener is rate-limiting requests. Please wait a moment and try again." },
          { status: 429 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Unexpected error contacting CourtListener." },
      { status: 500 },
    );
  }
}
