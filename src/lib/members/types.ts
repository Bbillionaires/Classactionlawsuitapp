export interface Member {
  id: number;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export type ClaimRequestStatus =
  | "requested"
  | "awaiting_documents"
  | "ready_to_file"
  | "filed"
  | "rejected"
  | "withdrawn";

export interface ClaimAuthorization {
  id: number;
  member_id: number;
  document_version: string;
  signed_name: string;
  agreed_at: string;
  ip_address: string | null;
  user_agent: string | null;
}

export interface ClaimRequest {
  id: number;
  member_id: number;
  settlement_id: number;
  status: ClaimRequestStatus;
  prep_fee_cents: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type MemberDocumentType = "government_id" | "claim_proof";

export interface MemberDocument {
  id: number;
  member_id: number;
  claim_request_id: number | null;
  doc_type: MemberDocumentType;
  file_url: string;
  file_name: string | null;
  uploaded_at: string;
}
