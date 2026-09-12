import "server-only";
import { Pool, type QueryResultRow } from "pg";

/**
 * Read-only access to the settlement-discovery database. The Next.js app
 * never writes here — only the separate discovery worker
 * (../../../worker) does. If DATABASE_URL isn't set (e.g. it hasn't been
 * provisioned yet), every query returns "no data" rather than throwing,
 * so the rest of the app keeps working without settlement info.
 */
let pool: Pool | null = null;

function getPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  if (!pool) pool = new Pool({ connectionString, max: 3 });
  return pool;
}

export async function querySettlements<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const db = getPool();
  if (!db) return [];
  const { rows } = await db.query<T>(sql, params);
  return rows;
}
