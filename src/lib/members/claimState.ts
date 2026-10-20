import "server-only";
import { getCurrentMemberId } from "./auth";
import { getClaimRequest, getLatestAuthorization } from "./repository";
import type { ClaimRequestStatus } from "./types";
import type { Settlement } from "@/lib/settlements/types";

export interface MemberClaimState {
  memberId: number | null;
  hasAuthorized: boolean;
  claimRequestStatusBySettlement: Map<number, ClaimRequestStatus>;
}

/**
 * The signed-in member's claim-filing state for a set of settlements (are
 * they signed in, have they signed the filing authorization, and any
 * existing claim-request status per settlement) — shared by every page
 * that renders SettlementCard/ClaimFilingCTA (/case/[id], /listing/[id]).
 * Best-effort: a signed-out visitor or a database hiccup here should never
 * break the page that called this.
 */
export async function loadMemberClaimState(
  settlements: Settlement[],
  context: string,
): Promise<MemberClaimState> {
  let memberId: number | null = null;
  let hasAuthorized = false;
  const claimRequestStatusBySettlement = new Map<number, ClaimRequestStatus>();
  try {
    memberId = await getCurrentMemberId();
    if (memberId) {
      const currentMemberId = memberId;
      const [authorization, claimRequests] = await Promise.all([
        getLatestAuthorization(currentMemberId),
        Promise.all(
          settlements.map((settlement) =>
            getClaimRequest(currentMemberId, settlement.id),
          ),
        ),
      ]);
      hasAuthorized = authorization !== null;
      settlements.forEach((settlement, i) => {
        const claimRequest = claimRequests[i];
        if (claimRequest) {
          claimRequestStatusBySettlement.set(settlement.id, claimRequest.status);
        }
      });
    }
  } catch (error) {
    console.error(`Failed to load member claim state for ${context}:`, error);
  }
  return { memberId, hasAuthorized, claimRequestStatusBySettlement };
}
