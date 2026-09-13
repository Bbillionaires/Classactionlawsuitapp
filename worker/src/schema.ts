import type { Pool } from "pg";

/**
 * Idempotent schema setup. Runs on every worker start — cheap no-ops after
 * the first run. TEXT + CHECK constraints are used instead of native
 * Postgres enums so this can stay idempotent without a migration framework
 * (Postgres has no `CREATE TYPE IF NOT EXISTS`).
 */
export async function ensureSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settlements (
      id BIGSERIAL PRIMARY KEY,

      -- Identity / provenance back to CourtListener. We never copy the full
      -- docket record here; CourtListener stays the source of truth for
      -- case-level facts (name, court, parties). This table only holds
      -- settlement-specific facts CourtListener doesn't model.
      courtlistener_docket_id BIGINT NOT NULL,
      case_name TEXT,
      docket_number TEXT,
      court_id TEXT,

      -- Public-facing status (spec: PENDING / ACTIVE / CLOSED) plus a more
      -- detailed internal stage.
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'closed')),
      stage TEXT NOT NULL DEFAULT 'pending'
        CHECK (stage IN (
          'pending', 'final_approval_pending', 'active',
          'payments_pending', 'paid_distributed', 'closed'
        )),

      settlement_administrator TEXT,
      settlement_website_url TEXT,
      settlement_website_domain TEXT,
      claim_form_url TEXT,
      settlement_amount TEXT,
      estimated_award TEXT,

      claim_deadline DATE,
      objection_deadline DATE,
      opt_out_deadline DATE,
      final_approval_hearing_date DATE,
      preliminary_approval_date DATE,
      final_approval_date DATE,

      class_definition TEXT,
      proof_requirements TEXT,

      -- Never trust an extracted URL by default. See worker/src/verify.ts.
      verification_status TEXT NOT NULL DEFAULT 'unverified'
        CHECK (verification_status IN ('verified', 'probable', 'unverified')),
      verification_source TEXT,
      confidence_score SMALLINT NOT NULL DEFAULT 0
        CHECK (confidence_score BETWEEN 0 AND 100),

      discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_settlements_docket
      ON settlements (courtlistener_docket_id);

    CREATE TABLE IF NOT EXISTS settlement_sources (
      id BIGSERIAL PRIMARY KEY,
      settlement_id BIGINT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,

      -- Which field this piece of evidence supports, e.g.
      -- "settlement_website_url" or "claim_deadline".
      extracted_field TEXT NOT NULL,
      extracted_value TEXT,

      courtlistener_docket_entry_id BIGINT,
      courtlistener_document_id BIGINT,
      source_document_url TEXT,
      matched_keyword TEXT,
      snippet TEXT,

      discovered_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_settlement_sources_settlement
      ON settlement_sources (settlement_id);

    CREATE TABLE IF NOT EXISTS worker_runs (
      id BIGSERIAL PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ,
      dockets_scanned INT NOT NULL DEFAULT 0,
      candidates_found INT NOT NULL DEFAULT 0,
      settlements_created INT NOT NULL DEFAULT 0,
      settlements_updated INT NOT NULL DEFAULT 0,
      error TEXT
    );
  `);
}
