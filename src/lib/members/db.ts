import "server-only";
import { Pool, type QueryResultRow } from "pg";
import { ensureSchema } from "./schema";

/**
 * Read-write access to the member/claims-filing data. Unlike
 * ../settlements/db.ts (read-only, degrades to [] with no DATABASE_URL),
 * this is core functionality — sign-up, sign-in, and claim filing simply
 * don't work without a database, so callers get a real error instead of
 * a silent empty result.
 */
let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — member accounts and claim filing require it.",
    );
  }
  if (!pool) pool = new Pool({ connectionString, max: 5 });
  return pool;
}

/** Runs the idempotent schema setup at most once per warm server instance. */
async function ready(): Promise<Pool> {
  const db = getPool();
  if (!schemaReady) schemaReady = ensureSchema(db);
  await schemaReady;
  return db;
}

export async function query<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const db = await ready();
  const { rows } = await db.query<T>(sql, params);
  return rows;
}

export async function queryOne<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}
