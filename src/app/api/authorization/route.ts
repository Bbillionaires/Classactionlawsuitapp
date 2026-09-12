import { NextRequest, NextResponse } from "next/server";
import { getCurrentMemberId } from "@/lib/members/auth";
import { DOCUMENT_VERSION } from "@/lib/members/authorizationDocument";
import { recordAuthorization } from "@/lib/members/repository";

export async function POST(request: NextRequest) {
  const memberId = await getCurrentMemberId();
  if (!memberId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let body: { signedName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const signedName = typeof body.signedName === "string" ? body.signedName.trim() : "";
  if (signedName.length < 2) {
    return NextResponse.json(
      { error: "Type your full legal name to sign." },
      { status: 400 },
    );
  }

  try {
    await recordAuthorization({
      memberId,
      documentVersion: DOCUMENT_VERSION,
      signedName,
      ipAddress:
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to record authorization:", error);
    return NextResponse.json(
      { error: "Something went wrong recording your signature." },
      { status: 500 },
    );
  }
}
