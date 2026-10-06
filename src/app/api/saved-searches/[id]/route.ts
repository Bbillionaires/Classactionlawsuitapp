import { NextRequest, NextResponse } from "next/server";
import { getCurrentMemberId } from "@/lib/members/auth";
import {
  deleteSavedSearchForMember,
  setSavedSearchAlertsEnabled,
} from "@/lib/members/repository";

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/saved-searches/[id]">,
) {
  const memberId = await getCurrentMemberId();
  if (!memberId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const { id } = await ctx.params;
  const savedSearchId = Number(id);
  if (!Number.isInteger(savedSearchId)) {
    return NextResponse.json({ error: "Invalid saved search id." }, { status: 400 });
  }

  let body: { alertsEnabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body.alertsEnabled !== "boolean") {
    return NextResponse.json({ error: "Missing alertsEnabled." }, { status: 400 });
  }

  try {
    const savedSearch = await setSavedSearchAlertsEnabled(
      memberId,
      savedSearchId,
      body.alertsEnabled,
    );
    if (!savedSearch) {
      return NextResponse.json({ error: "Saved search not found." }, { status: 404 });
    }
    return NextResponse.json({ savedSearch });
  } catch (error) {
    console.error("Failed to update saved search:", error);
    return NextResponse.json(
      { error: "Something went wrong updating this saved search." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/saved-searches/[id]">,
) {
  const memberId = await getCurrentMemberId();
  if (!memberId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const { id } = await ctx.params;
  const savedSearchId = Number(id);
  if (!Number.isInteger(savedSearchId)) {
    return NextResponse.json({ error: "Invalid saved search id." }, { status: 400 });
  }

  try {
    const deleted = await deleteSavedSearchForMember(memberId, savedSearchId);
    if (!deleted) {
      return NextResponse.json({ error: "Saved search not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete saved search:", error);
    return NextResponse.json(
      { error: "Something went wrong deleting this saved search." },
      { status: 500 },
    );
  }
}
