export type SettlementStatus = "pending" | "active" | "closed";
export type SettlementStage =
  | "pending"
  | "final_approval_pending"
  | "active"
  | "payments_pending"
  | "paid_distributed"
  | "closed";
export type VerificationStatus = "verified" | "probable" | "unverified";

export interface Settlement {
  id: number;
  // Null for a settlement listed by a public tracker (Top Class Actions,
  // classaction.org) that hasn't been independently matched to a real
  // court docket yet - see worker/src/discoverFromAggregator.ts. Always
  // paired with verification_status "unverified" when null.
  courtlistener_docket_id: number | null;
  case_name: string | null;
  docket_number: string | null;
  court_id: string | null;
  status: SettlementStatus;
  stage: SettlementStage;
  settlement_administrator: string | null;
  settlement_website_url: string | null;
  claim_form_url: string | null;
  settlement_amount: string | null;
  estimated_award: string | null;
  claim_deadline: string | null;
  objection_deadline: string | null;
  opt_out_deadline: string | null;
  final_approval_hearing_date: string | null;
  preliminary_approval_date: string | null;
  final_approval_date: string | null;
  class_definition: string | null;
  proof_requirements: string | null;
  verification_status: VerificationStatus;
  verification_source: string | null;
  confidence_score: number;
  discovered_at: string;
  last_verified_at: string | null;
}
