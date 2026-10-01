import type { Pool } from "pg";
import type { SettlementStage, SettlementStatus } from "./status.js";
import type { VerificationStatus } from "./extract.js";

export interface SettlementRow {
  id: number;
  courtlistener_docket_id: number;
  settlement_website_domain: string | null;
  settlement_administrator: string | null;
  confidence_score: number;
}

export interface SettlementInput {
  courtlistenerDocketId: number;
  caseName: string | null;
  docketNumber: string | null;
  courtId: string | null;
  settlementWebsiteUrl: string;
  settlementWebsiteDomain: string;
  settlementAdministrator: string | null;
  status: SettlementStatus;
  stage: SettlementStage;
  verificationStatus: VerificationStatus;
  verificationSource: string;
  confidenceScore: number;
  // Optional richer fields — populated when the discovery path actually
  // extracted them (currently only the aggregator-lead path does; the
  // CourtListener-text path only ever finds a bare URL). All nullable so
  // existing callers keep working unchanged.
  claimFormUrl?: string | null;
  settlementAmount?: string | null;
  estimatedAward?: string | null;
  claimDeadline?: Date | null;
  finalApprovalHearingDate?: Date | null;
  classDefinition?: string | null;
  proofRequirements?: string | null;
}

/**
 * Finds an existing settlement row for this docket that this candidate
 * should be merged into, per the dedup signals in the spec (docket +
 * domain, or docket + administrator). Returns null when this looks like
 * a genuinely new settlement for a docket that may already have others.
 */
export async function findMatchingSettlement(
  pool: Pool,
  docketId: number,
  candidate: { domain: string | null; administrator: string | null },
): Promise<SettlementRow | null> {
  const { rows } = await pool.query<SettlementRow>(
    `SELECT id, courtlistener_docket_id, settlement_website_domain,
            settlement_administrator, confidence_score
     FROM settlements
     WHERE courtlistener_docket_id = $1
     ORDER BY id`,
    [docketId],
  );
  if (rows.length === 0) return null;

  for (const row of rows) {
    if (
      candidate.domain &&
      row.settlement_website_domain &&
      row.settlement_website_domain === candidate.domain
    ) {
      return row;
    }
    if (
      candidate.administrator &&
      row.settlement_administrator &&
      row.settlement_administrator === candidate.administrator
    ) {
      return row;
    }
  }

  // No confirmed match by domain/administrator. Most dockets only ever
  // have one settlement; if there's exactly one existing row and it has
  // no distinguishing domain/administrator recorded yet, treat this as
  // the same settlement rather than spawning a duplicate while its
  // record is still sparse.
  if (
    rows.length === 1 &&
    !rows[0].settlement_website_domain &&
    !rows[0].settlement_administrator
  ) {
    return rows[0];
  }

  return null;
}

/**
 * Inserts a new settlement, or updates an existing one — never
 * downgrading a higher-confidence fact with a weaker later one.
 * Returns the settlement's id.
 */
export async function upsertSettlement(
  pool: Pool,
  existing: SettlementRow | null,
  input: SettlementInput,
): Promise<number> {
  if (!existing) {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO settlements (
        courtlistener_docket_id, case_name, docket_number, court_id,
        settlement_website_url, settlement_website_domain, settlement_administrator,
        claim_form_url, settlement_amount, estimated_award, claim_deadline,
        final_approval_hearing_date, class_definition, proof_requirements,
        status, stage, verification_status, verification_source, confidence_score,
        last_verified_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now())
      RETURNING id`,
      [
        input.courtlistenerDocketId,
        input.caseName,
        input.docketNumber,
        input.courtId,
        input.settlementWebsiteUrl,
        input.settlementWebsiteDomain,
        input.settlementAdministrator,
        input.claimFormUrl ?? null,
        input.settlementAmount ?? null,
        input.estimatedAward ?? null,
        input.claimDeadline ?? null,
        input.finalApprovalHearingDate ?? null,
        input.classDefinition ?? null,
        input.proofRequirements ?? null,
        input.status,
        input.stage,
        input.verificationStatus,
        input.verificationSource,
        input.confidenceScore,
      ],
    );
    return rows[0].id;
  }

  // Only overwrite the URL/verification fields if this finding is at
  // least as confident as what's already stored. The descriptive fields
  // (amount, deadline, proof, etc.) merge in alongside them — COALESCE
  // keeps whatever was already known if this finding didn't include one.
  if (input.confidenceScore >= existing.confidence_score) {
    await pool.query(
      `UPDATE settlements SET
        case_name = COALESCE($2, case_name),
        docket_number = COALESCE($3, docket_number),
        court_id = COALESCE($4, court_id),
        settlement_website_url = $5,
        settlement_website_domain = $6,
        settlement_administrator = COALESCE($7, settlement_administrator),
        claim_form_url = COALESCE($8, claim_form_url),
        settlement_amount = COALESCE($9, settlement_amount),
        estimated_award = COALESCE($10, estimated_award),
        claim_deadline = COALESCE($11, claim_deadline),
        final_approval_hearing_date = COALESCE($12, final_approval_hearing_date),
        class_definition = COALESCE($13, class_definition),
        proof_requirements = COALESCE($14, proof_requirements),
        status = $15,
        stage = $16,
        verification_status = $17,
        verification_source = $18,
        confidence_score = $19,
        last_verified_at = now(),
        updated_at = now()
      WHERE id = $1`,
      [
        existing.id,
        input.caseName,
        input.docketNumber,
        input.courtId,
        input.settlementWebsiteUrl,
        input.settlementWebsiteDomain,
        input.settlementAdministrator,
        input.claimFormUrl ?? null,
        input.settlementAmount ?? null,
        input.estimatedAward ?? null,
        input.claimDeadline ?? null,
        input.finalApprovalHearingDate ?? null,
        input.classDefinition ?? null,
        input.proofRequirements ?? null,
        input.status,
        input.stage,
        input.verificationStatus,
        input.verificationSource,
        input.confidenceScore,
      ],
    );
  } else {
    await pool.query(
      `UPDATE settlements SET last_verified_at = now(), updated_at = now() WHERE id = $1`,
      [existing.id],
    );
  }
  return existing.id;
}

export async function recordSource(
  pool: Pool,
  settlementId: number,
  source: {
    extractedField: string;
    extractedValue: string;
    courtlistenerDocketEntryId: number | null;
    courtlistenerDocumentId?: number | null;
    matchedKeyword: string | null;
    snippet: string;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO settlement_sources (
      settlement_id, extracted_field, extracted_value,
      courtlistener_docket_entry_id, courtlistener_document_id,
      matched_keyword, snippet
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      settlementId,
      source.extractedField,
      source.extractedValue,
      source.courtlistenerDocketEntryId,
      source.courtlistenerDocumentId ?? null,
      source.matchedKeyword,
      source.snippet,
    ],
  );
}

export async function recordWorkerRun(
  pool: Pool,
  stats: {
    docketsScanned: number;
    candidatesFound: number;
    settlementsCreated: number;
    settlementsUpdated: number;
    error: string | null;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO worker_runs (
      finished_at, dockets_scanned, candidates_found,
      settlements_created, settlements_updated, error
    ) VALUES (now(), $1, $2, $3, $4, $5)`,
    [
      stats.docketsScanned,
      stats.candidatesFound,
      stats.settlementsCreated,
      stats.settlementsUpdated,
      stats.error,
    ],
  );
}
