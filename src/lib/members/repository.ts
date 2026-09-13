import "server-only";
import { query, queryOne } from "./db";
import type {
  ClaimAuthorization,
  ClaimRequest,
  Member,
  MemberDocument,
  MemberDocumentType,
} from "./types";

export async function findMemberByEmail(email: string): Promise<Member | null> {
  return queryOne<Member>("SELECT * FROM members WHERE email = $1", [
    email.toLowerCase().trim(),
  ]);
}

export async function createMember(
  email: string,
  passwordHash: string,
): Promise<Member> {
  const row = await queryOne<Member>(
    `INSERT INTO members (email, password_hash) VALUES ($1, $2) RETURNING *`,
    [email.toLowerCase().trim(), passwordHash],
  );
  if (!row) throw new Error("Failed to create member.");
  return row;
}

export async function getLatestAuthorization(
  memberId: number,
): Promise<ClaimAuthorization | null> {
  return queryOne<ClaimAuthorization>(
    `SELECT * FROM claim_authorizations
     WHERE member_id = $1
     ORDER BY agreed_at DESC
     LIMIT 1`,
    [memberId],
  );
}

export async function recordAuthorization(input: {
  memberId: number;
  documentVersion: string;
  signedName: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<ClaimAuthorization> {
  const row = await queryOne<ClaimAuthorization>(
    `INSERT INTO claim_authorizations
       (member_id, document_version, signed_name, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.memberId,
      input.documentVersion,
      input.signedName,
      input.ipAddress,
      input.userAgent,
    ],
  );
  if (!row) throw new Error("Failed to record authorization.");
  return row;
}

export async function listClaimRequestsForMember(
  memberId: number,
): Promise<ClaimRequest[]> {
  return query<ClaimRequest>(
    `SELECT * FROM claim_requests WHERE member_id = $1 ORDER BY created_at DESC`,
    [memberId],
  );
}

export async function getClaimRequest(
  memberId: number,
  settlementId: number,
): Promise<ClaimRequest | null> {
  return queryOne<ClaimRequest>(
    `SELECT * FROM claim_requests WHERE member_id = $1 AND settlement_id = $2`,
    [memberId, settlementId],
  );
}

export async function createClaimRequest(
  memberId: number,
  settlementId: number,
): Promise<ClaimRequest> {
  const row = await queryOne<ClaimRequest>(
    `INSERT INTO claim_requests (member_id, settlement_id)
     VALUES ($1, $2)
     ON CONFLICT (member_id, settlement_id) DO UPDATE
       SET updated_at = now()
     RETURNING *`,
    [memberId, settlementId],
  );
  if (!row) throw new Error("Failed to create claim request.");
  return row;
}

export async function listDocumentsForMember(
  memberId: number,
): Promise<MemberDocument[]> {
  return query<MemberDocument>(
    `SELECT * FROM member_documents WHERE member_id = $1 ORDER BY uploaded_at DESC`,
    [memberId],
  );
}

export async function addMemberDocument(input: {
  memberId: number;
  claimRequestId: number | null;
  docType: MemberDocumentType;
  fileUrl: string;
  fileName: string | null;
}): Promise<MemberDocument> {
  const row = await queryOne<MemberDocument>(
    `INSERT INTO member_documents
       (member_id, claim_request_id, doc_type, file_url, file_name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.memberId,
      input.claimRequestId,
      input.docType,
      input.fileUrl,
      input.fileName,
    ],
  );
  if (!row) throw new Error("Failed to record uploaded document.");
  return row;
}
