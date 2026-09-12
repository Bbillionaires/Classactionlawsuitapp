import type { Pool } from "pg";

/**
 * Idempotent schema setup for the member/claims-filing domain, mirroring
 * the pattern in worker/src/schema.ts (TEXT + CHECK instead of native
 * enums, so this stays idempotent without a migration framework).
 *
 * `settlement_id` on claim_requests deliberately has no FK constraint:
 * the `settlements` table is owned and created by the separate discovery
 * worker (worker/src/schema.ts), and this app must not depend on that
 * table already existing — the two schemas are independently idempotent
 * against the same database.
 */
export async function ensureSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- The one-link authorization-to-file / hold-harmless agreement. One
    -- row per member per time they sign it (a re-sign after we update the
    -- document text creates a new row rather than overwriting history).
    CREATE TABLE IF NOT EXISTS claim_authorizations (
      id BIGSERIAL PRIMARY KEY,
      member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      document_version TEXT NOT NULL,
      signed_name TEXT NOT NULL,
      agreed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ip_address TEXT,
      user_agent TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_claim_authorizations_member
      ON claim_authorizations (member_id);

    CREATE TABLE IF NOT EXISTS claim_requests (
      id BIGSERIAL PRIMARY KEY,
      member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      settlement_id BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN (
          'requested', 'awaiting_documents', 'ready_to_file',
          'filed', 'rejected', 'withdrawn'
        )),
      -- No payment integration yet (deliberately deferred) — this is
      -- informational only until Stripe is wired up.
      prep_fee_cents INT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (member_id, settlement_id)
    );

    CREATE INDEX IF NOT EXISTS idx_claim_requests_member
      ON claim_requests (member_id);

    CREATE TABLE IF NOT EXISTS member_documents (
      id BIGSERIAL PRIMARY KEY,
      member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      claim_request_id BIGINT REFERENCES claim_requests(id) ON DELETE SET NULL,
      doc_type TEXT NOT NULL CHECK (doc_type IN ('government_id', 'claim_proof')),
      file_url TEXT NOT NULL,
      file_name TEXT,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_member_documents_member
      ON member_documents (member_id);
    CREATE INDEX IF NOT EXISTS idx_member_documents_claim_request
      ON member_documents (claim_request_id);
  `);
}
