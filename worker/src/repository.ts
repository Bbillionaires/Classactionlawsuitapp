import type { Pool } from "pg";
import type { SettlementStage, SettlementStatus } from "./status.js";
import type { VerificationStatus } from "./extract.js";

export interface SettlementRow {
  id: number;
  courtlistener_docket_id: number | null;
  settlement_website_domain: string | null;
  settlement_administrator: string | null;
  confidence_score: number;
}

export interface SettlementInput {
  courtlistenerDocketId: number | null;
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
  // extracted them. All nullable so existing callers keep working
  // unchanged.
  claimFormUrl?: string | null;
  settlementAmount?: string | null;
  estimatedAward?: string | null;
  claimDeadline?: Date | null;
  finalApprovalHearingDate?: Date | null;
  classDefinition?: string | null;
  proofRequirements?: string | null;
}

function pickMatch(
  rows: SettlementRow[],
  candidate: { domain: string | null; administrator: string | null },
): SettlementRow | null {
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
 * Finds an existing settlement row for this docket that this candidate
 * should be merged into, per the dedup signals in the spec (docket +
 * domain, or docket + administrator). Returns null when this looks like
 * a genuinely new settlement for a docket that may already have others,
 * or when there's no docket at all yet to scope the search by (see
 * findSettlementByUrl below for that case instead).
 *
 * Deliberately scoped to rows sharing this exact docket - domain and
 * administrator are only ever used as tie-breakers *among* those, never
 * as a standalone lookup key on their own. A settlement-administrator
 * domain (kccllc.com, epiqsystems.com, etc.) routinely hosts hundreds of
 * unrelated settlements for completely different cases, so matching on
 * domain alone, table-wide, would merge them into one row.
 */
export async function findMatchingSettlement(
  pool: Pool,
  docketId: number | null,
  candidate: { domain: string | null; administrator: string | null },
): Promise<SettlementRow | null> {
  if (docketId === null) return null;
  const { rows } = await pool.query<SettlementRow>(
    `SELECT id, courtlistener_docket_id, settlement_website_domain,
            settlement_administrator, confidence_score
     FROM settlements
     WHERE courtlistener_docket_id = $1
     ORDER BY id`,
    [docketId],
  );
  return pickMatch(rows, candidate);
}

/**
 * Finds an existing settlement row by the lead source's own stable
 * identifier (the tracker's own listing/detail-page URL - e.g. TCA's
 * article URL, or classaction.org's `#slug` anchor - recorded as
 * settlement_sources.snippet by discoverFromAggregator.ts's recordSource
 * call) - used only by that path. This is a far stronger identity key
 * than either domain (a shared administrator domain like kccllc.com hosts
 * hundreds of unrelated settlements) or the *official* settlement site
 * URL a lead resolves to (which a source's own page can in principle
 * expose differently between scrapes - a settlement-website field that
 * appears on one pass and not the next would otherwise silently break the
 * link to the existing row and create a duplicate). Works whether or not
 * a docket has been matched yet, which is what lets a lead first
 * published "unverified" (no docket match) upgrade its own row in place
 * once a later run does find one, instead of spawning a duplicate.
 */
export async function findSettlementBySourceIdentifier(
  pool: Pool,
  sourceIdentifier: string,
): Promise<SettlementRow | null> {
  const { rows } = await pool.query<SettlementRow>(
    `SELECT s.id, s.courtlistener_docket_id, s.settlement_website_domain,
            s.settlement_administrator, s.confidence_score
     FROM settlement_sources ss
     JOIN settlements s ON s.id = ss.settlement_id
     WHERE ss.snippet = $1
     ORDER BY ss.discovered_at DESC
     LIMIT 1`,
    [sourceIdentifier],
  );
  return rows[0] ?? null;
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
        courtlistener_docket_id = COALESCE($20, courtlistener_docket_id),
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
        input.courtlistenerDocketId,
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

// Every descriptive field worth preserving from a duplicate before it's
// deleted - courtlistener_docket_id and the identity columns (case_name,
// settlement_website_domain) are deliberately excluded: the keeper's own
// docket id is left as-is rather than silently repointing the surviving
// row at a different real docket.
const MERGEABLE_FIELDS = [
  "docket_number",
  "court_id",
  "settlement_administrator",
  "settlement_website_url",
  "claim_form_url",
  "settlement_amount",
  "estimated_award",
  "claim_deadline",
  "objection_deadline",
  "opt_out_deadline",
  "final_approval_hearing_date",
  "preliminary_approval_date",
  "final_approval_date",
  "class_definition",
  "proof_requirements",
] as const;

interface MergeableSettlementRow {
  id: number;
  docket_number: string | null;
  court_id: string | null;
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
}

interface ClaimRequestRow {
  id: number;
  member_id: number;
  settlement_id: number;
  // node-postgres returns a TIMESTAMPTZ column as a JS Date, not a
  // string - there's no custom type parser in this project overriding
  // that (see db.ts).
  created_at: Date;
}

/**
 * Merges duplicate settlement rows left over from before the
 * aggregator-lead path deduped leads by their own stable source URL (see
 * findSettlementBySourceIdentifier) - it used to dedupe by docket id
 * alone, so the same real settlement resolving to two *different*
 * CourtListener dockets on separate runs (common for multi-district
 * litigation, where several member-case dockets can share one
 * settlement) created two separate rows instead of updating one. Safe to
 * run on every worker start: idempotent, and a no-op once nothing is left
 * to merge.
 *
 * Also an ongoing safety net, not a true one-time fix: the CourtListener
 * text-search discovery path (discover.ts) still dedupes strictly by
 * exact docket id, so rediscovering a *different* member-case docket for
 * an already-merged settlement can still create a fresh duplicate later.
 * This pass will simply merge it again on its next run - acceptable since
 * the merge itself no longer loses data (see below), unlike leaving the
 * duplicate-creation possible at the source, which would need discover.ts
 * to gain the same lead-identity-based dedup the aggregator path has, a
 * larger change out of scope here.
 *
 * Groups by (case_name, settlement_website_domain) - two genuinely
 * different settlements sharing both an exact case name and exact
 * official-site domain is not a realistic coincidence in the duplicates
 * actually observed in production, unlike domain alone (see the review
 * finding in PR #11 that ruled domain-only matching out for this exact
 * reason). It's possible in principle for one umbrella multi-district
 * litigation to run two genuinely distinct settlement tracks under a
 * shared docket caption and a shared central administrator site, which
 * would wrongly merge them - a residual, intentionally accepted risk,
 * mitigated by the fact that merging now preserves every duplicate's own
 * descriptive data onto the keeper (next) rather than discarding it, so
 * even a wrong merge loses no information, just consolidates display.
 *
 * `claim_requests` has no FK to `settlements` (deliberately - see
 * src/lib/members/schema.ts) but shares the same database, so a
 * duplicate's settlement_sources and any member's claim_requests are
 * reassigned to the kept row before the duplicate is deleted, rather than
 * left dangling or silently losing a member's filing history. A member
 * who already has requests against more than one row in the same group
 * (the one case this could violate claim_requests' own
 * (member_id, settlement_id) uniqueness constraint) keeps exactly one of
 * them, consolidated onto the keeper, rather than attempting to point two
 * rows at the same (member, settlement) pair.
 */
export async function mergeDuplicateSettlements(pool: Pool): Promise<number> {
  const { rows: groups } = await pool.query<{ ids: number[] }>(
    `SELECT array_agg(id ORDER BY confidence_score DESC, last_verified_at DESC NULLS LAST, id) AS ids
     FROM settlements
     WHERE case_name IS NOT NULL AND settlement_website_domain IS NOT NULL
     GROUP BY case_name, settlement_website_domain
     HAVING COUNT(*) > 1`,
  );

  let mergedCount = 0;
  for (const group of groups) {
    const [keeperId, ...duplicateIds] = group.ids;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Fill any gap in the keeper's own descriptive fields from whichever
      // duplicate (in keeper-selection order, i.e. highest confidence
      // first) has a value, rather than just discarding whatever the
      // duplicates knew that the keeper didn't.
      const { rows: groupRows } = await client.query<MergeableSettlementRow>(
        `SELECT id, ${MERGEABLE_FIELDS.join(", ")} FROM settlements WHERE id = ANY($1::bigint[])`,
        [group.ids],
      );
      const rowsById = new Map(groupRows.map((row) => [row.id, row]));
      const orderedRows = group.ids.map((id) => rowsById.get(id)).filter((row) => row != null);
      const mergedValues: Record<string, unknown> = {};
      for (const field of MERGEABLE_FIELDS) {
        for (const row of orderedRows) {
          if (row[field] != null) {
            mergedValues[field] = row[field];
            break;
          }
        }
      }
      const setClauses = MERGEABLE_FIELDS.map((field, i) => `${field} = $${i + 2}`).join(", ");
      await client.query(
        `UPDATE settlements SET ${setClauses}, updated_at = now() WHERE id = $1`,
        [keeperId, ...MERGEABLE_FIELDS.map((field) => mergedValues[field] ?? null)],
      );

      await client.query(
        `UPDATE settlement_sources SET settlement_id = $1 WHERE settlement_id = ANY($2::bigint[])`,
        [keeperId, duplicateIds],
      );

      // A member can have at most one claim_requests row per settlement
      // id (the UNIQUE constraint) but could already have one against
      // more than one row in this group - reassigning each individually
      // (rather than one blanket UPDATE) lets each member end up with
      // exactly one, consolidated onto the keeper, instead of risking two
      // reassignments landing on the same (member, keeper) pair at once.
      const { rows: claimRequestRows } = await client.query<ClaimRequestRow>(
        `SELECT id, member_id, settlement_id, created_at FROM claim_requests WHERE settlement_id = ANY($1::bigint[])`,
        [group.ids],
      );
      const claimRequestsByMember = new Map<number, ClaimRequestRow[]>();
      for (const row of claimRequestRows) {
        const forMember = claimRequestsByMember.get(row.member_id) ?? [];
        forMember.push(row);
        claimRequestsByMember.set(row.member_id, forMember);
      }
      for (const memberRows of claimRequestsByMember.values()) {
        // Prefer a request already on the keeper, if any; otherwise the
        // member's original request (earliest) - which exact one barely
        // matters since every row in this group represents the same
        // real-world settlement, but something concrete has to be chosen.
        const keepRow =
          memberRows.find((row) => row.settlement_id === keeperId) ??
          [...memberRows].sort((a, b) => a.created_at.getTime() - b.created_at.getTime())[0];
        if (keepRow.settlement_id !== keeperId) {
          await client.query(`UPDATE claim_requests SET settlement_id = $1 WHERE id = $2`, [
            keeperId,
            keepRow.id,
          ]);
        }
        const redundantIds = memberRows
          .filter((row) => row.id !== keepRow.id)
          .map((row) => row.id);
        if (redundantIds.length > 0) {
          await client.query(`DELETE FROM claim_requests WHERE id = ANY($1::bigint[])`, [
            redundantIds,
          ]);
        }
      }

      await client.query(`DELETE FROM settlements WHERE id = ANY($1::bigint[])`, [duplicateIds]);
      await client.query("COMMIT");
      mergedCount += duplicateIds.length;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(
        `[dedupe] failed to merge duplicate settlements ${JSON.stringify(group.ids)}:`,
        err,
      );
    } finally {
      client.release();
    }
  }
  return mergedCount;
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
