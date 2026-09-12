import { NextRequest, NextResponse } from "next/server";
import {
  CourtListenerApiError,
  CourtListenerConfigError,
  searchClassActionCases,
} from "@/lib/courtlistener";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = params.get("q")?.trim() ?? "";
  const courtId = params.get("court")?.trim() || undefined;
  const filedAfter = params.get("filed_after")?.trim() || undefined;
  const filedBefore = params.get("filed_before")?.trim() || undefined;
  const cursor = params.get("cursor")?.trim() || undefined;

  try {
    const results = await searchClassActionCases({
      query,
      courtId,
      filedAfter,
      filedBefore,
      cursor,
    });
    return NextResponse.json(results);
  } catch (error) {
    if (error instanceof CourtListenerConfigError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (error instanceof CourtListenerApiError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Unexpected error contacting CourtListener." },
      { status: 500 },
    );
  }
}
