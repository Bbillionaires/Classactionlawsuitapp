export type SettlementStatus = "pending" | "active" | "closed";
export type SettlementStage =
  | "pending"
  | "final_approval_pending"
  | "active"
  | "payments_pending"
  | "paid_distributed"
  | "closed";

/**
 * Derives the public status + detailed stage from whatever facts we've
 * actually discovered. Deliberately conservative: without a claim
 * deadline we can't know a claim period has *opened*, only that a
 * website was found, so that alone yields "pending", not "active".
 */
export function deriveStatusAndStage(input: {
  hasWebsite: boolean;
  claimDeadline: Date | null;
  finalApprovalDate: Date | null;
}): { status: SettlementStatus; stage: SettlementStage } {
  const { hasWebsite, claimDeadline, finalApprovalDate } = input;
  const now = new Date();

  if (claimDeadline && claimDeadline < now) {
    return { status: "closed", stage: "closed" };
  }
  if (hasWebsite && claimDeadline && claimDeadline >= now) {
    return { status: "active", stage: "active" };
  }
  if (hasWebsite && finalApprovalDate) {
    return { status: "active", stage: "active" };
  }
  if (hasWebsite) {
    return { status: "pending", stage: "final_approval_pending" };
  }
  return { status: "pending", stage: "pending" };
}
