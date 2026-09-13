import { NextRequest, NextResponse } from "next/server";
import { listOpenSettlements, type ProofFilter } from "@/lib/settlements/repository";

const VALID_PROOF: ProofFilter[] = ["any", "required", "not_required"];

export async function GET(request: NextRequest) {
  const proofParam = request.nextUrl.searchParams.get("proof");
  const proof = VALID_PROOF.includes(proofParam as ProofFilter)
    ? (proofParam as ProofFilter)
    : "any";

  try {
    const settlements = await listOpenSettlements({ proof });
    return NextResponse.json({ settlements });
  } catch (error) {
    console.error("Failed to load open settlements:", error);
    // Best-effort feature: an empty list beats a broken homepage.
    return NextResponse.json({ settlements: [] });
  }
}
