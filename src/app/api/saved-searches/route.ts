import { NextRequest, NextResponse } from "next/server";
import { getCurrentMemberId } from "@/lib/members/auth";
import {
  createSavedSearch,
  listSavedSearchesForMember,
} from "@/lib/members/repository";
import type { SavedSearchSort } from "@/lib/members/types";

const SORT_VALUES: SavedSearchSort[] = ["relevance", "newest", "oldest"];

export async function GET() {
  const memberId = await getCurrentMemberId();
  if (!memberId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  try {
    const savedSearches = await listSavedSearchesForMember(memberId);
    return NextResponse.json({ savedSearches });
  } catch (error) {
    console.error("Failed to list saved searches:", error);
    return NextResponse.json(
      { error: "Something went wrong loading your saved searches." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const memberId = await getCurrentMemberId();
  if (!memberId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let body: {
    name?: unknown;
    query?: unknown;
    courtId?: unknown;
    cause?: unknown;
    filedAfter?: unknown;
    filedBefore?: unknown;
    sort?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Name this search before saving it." }, { status: 400 });
  }

  const sort =
    typeof body.sort === "string" && SORT_VALUES.includes(body.sort as SavedSearchSort)
      ? (body.sort as SavedSearchSort)
      : "relevance";

  const asStringOrNull = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null;

  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const asDateOrNull = (value: unknown): string | null | "invalid" => {
    const str = asStringOrNull(value);
    if (str === null) return null;
    return DATE_PATTERN.test(str) ? str : "invalid";
  };

  const filedAfter = asDateOrNull(body.filedAfter);
  const filedBefore = asDateOrNull(body.filedBefore);
  if (filedAfter === "invalid" || filedBefore === "invalid") {
    return NextResponse.json(
      { error: "Dates must be in YYYY-MM-DD format." },
      { status: 400 },
    );
  }

  try {
    const savedSearch = await createSavedSearch({
      memberId,
      name,
      query: typeof body.query === "string" ? body.query : "",
      courtId: asStringOrNull(body.courtId),
      cause: asStringOrNull(body.cause),
      filedAfter,
      filedBefore,
      sort,
    });
    return NextResponse.json({ savedSearch });
  } catch (error) {
    console.error("Failed to create saved search:", error);
    return NextResponse.json(
      { error: "Something went wrong saving this search." },
      { status: 500 },
    );
  }
}
