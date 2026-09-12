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
