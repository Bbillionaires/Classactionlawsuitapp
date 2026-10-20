import type { Settlement } from "./types";

/**
 * Where a settlement's own detail page lives: a real court docket page
 * (/case/[id], keyed by the CourtListener docket id) if it's been matched
 * to one, or the lightweight /listing/[id] page (keyed by the settlement's
 * own internal id) if it hasn't — see /listing/[id]/page.tsx and
 * discoverFromAggregator.ts for why an unmatched settlement is still
 * published at all.
 */
export function settlementHref(
  settlement: Pick<Settlement, "id" | "courtlistener_docket_id">,
): string {
  return settlement.courtlistener_docket_id !== null
    ? `/case/${settlement.courtlistener_docket_id}`
    : `/listing/${settlement.id}`;
}
