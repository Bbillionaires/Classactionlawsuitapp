import "server-only";
import { querySettlements } from "./db";
import type { Settlement } from "./types";

/** All discovered settlements for a docket, most recently verified first. */
export async function getSettlementsForDocket(
  docketId: string,
): Promise<Settlement[]> {
  return querySettlements<Settlement>(
    `SELECT * FROM settlements
     WHERE courtlistener_docket_id = $1
     ORDER BY confidence_score DESC, updated_at DESC`,
    [Number(docketId)],
  );
}

export type ProofFilter = "any" | "required" | "not_required";

/**
 * Open (status = "active") settlements — the ones a claimant can actually
 * do something with right now, as opposed to "pending" (filed but not
 * yet at claims stage) or "closed". This is what the homepage's open-
 * claims section and the site-wide ticker both read from.
 */
export async function listOpenSettlements(
  options: { proof?: ProofFilter; limit?: number } = {},
): Promise<Settlement[]> {
  const { proof = "any", limit = 50 } = options;
  const proofClause =
    proof === "required"
      ? "AND proof_requirements IS NOT NULL AND proof_requirements <> ''"
      : proof === "not_required"
        ? "AND (proof_requirements IS NULL OR proof_requirements = '')"
        : "";

  return querySettlements<Settlement>(
    `SELECT * FROM settlements
     WHERE status = 'active'
     ${proofClause}
     ORDER BY confidence_score DESC, updated_at DESC
     LIMIT $1`,
    [limit],
  );
}

/**
 * Minimal display info for a set of settlement ids — used by the member
 * account page to show what each of a member's claim requests is about
 * (case name, and the docket id to link back to /case/[id]) without
 * duplicating settlement data into the members schema.
 */
export async function getSettlementsByIds(
  ids: number[],
): Promise<Pick<Settlement, "id" | "case_name" | "courtlistener_docket_id" | "status">[]> {
  if (ids.length === 0) return [];
  return querySettlements(
    `SELECT id, case_name, courtlistener_docket_id, status
     FROM settlements
     WHERE id = ANY($1::bigint[])`,
    [ids],
  );
}
