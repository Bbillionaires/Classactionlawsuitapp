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

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MINUTES = 15;

/** 0 if not currently locked out, otherwise how long until the lockout clears. */
export async function getLoginLockoutRemainingMs(email: string): Promise<number> {
  const row = await queryOne<{ locked_until: string | null }>(
    "SELECT locked_until FROM login_throttle WHERE email = $1",
    [email.toLowerCase().trim()],
  );
  if (!row?.locked_until) return 0;
  const remaining = new Date(row.locked_until).getTime() - Date.now();
  return remaining > 0 ? remaining : 0;
}

/**
 * Call on every failed login attempt (wrong password, or no such member -
 * the caller shouldn't distinguish the two). The WHERE clause skips the
 * update entirely while an existing lockout is still active, so attempts
 * made during a lockout don't keep pushing it further into the future.
 */
export async function recordFailedLogin(email: string): Promise<void> {
  await query(
    `INSERT INTO login_throttle (email, failed_attempts, locked_until, updated_at)
     VALUES ($1, 1, NULL, now())
     ON CONFLICT (email) DO UPDATE SET
       failed_attempts = login_throttle.failed_attempts + 1,
       locked_until = CASE
         WHEN login_throttle.failed_attempts + 1 >= $2
           THEN now() + make_interval(mins => $3)
         ELSE NULL
       END,
       updated_at = now()
     WHERE login_throttle.locked_until IS NULL OR login_throttle.locked_until <= now()`,
    [email.toLowerCase().trim(), MAX_FAILED_LOGIN_ATTEMPTS, LOGIN_LOCKOUT_MINUTES],
  );
}

/** Call on every successful login to reset the counter. */
export async function clearFailedLogins(email: string): Promise<void> {
  await query("DELETE FROM login_throttle WHERE email = $1", [
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

/** Scoped to memberId so a caller can never reference another member's claim request. */
export async function getClaimRequestByIdForMember(
  memberId: number,
  claimRequestId: number,
): Promise<ClaimRequest | null> {
  return queryOne<ClaimRequest>(
    `SELECT * FROM claim_requests WHERE id = $1 AND member_id = $2`,
    [claimRequestId, memberId],
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
