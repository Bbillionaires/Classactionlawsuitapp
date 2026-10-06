import { NextRequest, NextResponse } from "next/server";
import { getCurrentMemberId } from "@/lib/members/auth";
import {
  createClaimRequest,
  getLatestAuthorization,
} from "@/lib/members/repository";
import { getSettlementsByIds } from "@/lib/settlements/repository";

export async function POST(request: NextRequest) {
  const memberId = await getCurrentMemberId();
  if (!memberId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let body: { settlementId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const settlementId = Number(body.settlementId);
  if (!Number.isInteger(settlementId)) {
    return NextResponse.json({ error: "Missing settlement id." }, { status: 400 });
  }

  // settlements is owned by the discovery worker's schema (no FK here by
  // design - see src/lib/members/schema.ts) - without this check, any
  // signed-in member could POST an arbitrary/made-up id and create a
  // claim_requests row referencing nothing real.
  const [settlement] = await getSettlementsByIds([settlementId]);
  if (!settlement) {
    return NextResponse.json({ error: "Settlement not found." }, { status: 404 });
  }

  const authorization = await getLatestAuthorization(memberId);
  if (!authorization) {
    return NextResponse.json(
      { error: "Sign the claim-filing authorization first.", code: "AUTHORIZATION_REQUIRED" },
      { status: 412 },
    );
  }

  try {
    const claimRequest = await createClaimRequest(memberId, settlementId);
    return NextResponse.json({ claimRequest });
  } catch (error) {
    console.error("Failed to create claim request:", error);
    return NextResponse.json(
      { error: "Something went wrong requesting help with this claim." },
      { status: 500 },
    );
  }
}
