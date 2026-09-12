import { pool } from "./db.js";
import { ensureSchema } from "./schema.js";
import { runDiscovery } from "./discover.js";
import { recordWorkerRun } from "./repository.js";

async function main(): Promise<void> {
  console.log("[worker] ensuring schema...");
  await ensureSchema(pool);

  console.log("[worker] starting discovery run...");
  const startedAt = Date.now();
  try {
    const stats = await runDiscovery(pool);
    await recordWorkerRun(pool, { ...stats, error: null });
    console.log(
      `[worker] done in ${Math.round((Date.now() - startedAt) / 1000)}s:`,
      stats,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[worker] run failed:", err);
    await recordWorkerRun(pool, {
      docketsScanned: 0,
      candidatesFound: 0,
      settlementsCreated: 0,
      settlementsUpdated: 0,
      error: message,
    });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
