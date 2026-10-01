import { pool } from "./db.js";
import { ensureSchema } from "./schema.js";
import { runDiscovery, type RunStats } from "./discover.js";
import { runAggregatorDiscovery } from "./discoverFromAggregator.js";
import { recordWorkerRun } from "./repository.js";

async function main(): Promise<void> {
  console.log("[worker] ensuring schema...");
  await ensureSchema(pool);

  const startedAt = Date.now();
  const stats: RunStats = {
    docketsScanned: 0,
    candidatesFound: 0,
    settlementsCreated: 0,
    settlementsUpdated: 0,
  };
  const errors: string[] = [];

  // Two independent discovery paths, each allowed to fail without taking
  // the other down with it — a rate-limit hiccup on one shouldn't zero
  // out real results the other path already found this run.
  console.log("[worker] starting CourtListener discovery run...");
  try {
    const clStats = await runDiscovery(pool);
    stats.docketsScanned += clStats.docketsScanned;
    stats.candidatesFound += clStats.candidatesFound;
    stats.settlementsCreated += clStats.settlementsCreated;
    stats.settlementsUpdated += clStats.settlementsUpdated;
  } catch (err) {
    console.error("[worker] CourtListener discovery failed:", err);
    errors.push(`CourtListener: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log("[worker] starting aggregator-lead discovery run...");
  try {
    await runAggregatorDiscovery(pool, stats);
  } catch (err) {
    console.error("[worker] aggregator discovery failed:", err);
    errors.push(`Aggregator: ${err instanceof Error ? err.message : String(err)}`);
  }

  await recordWorkerRun(pool, {
    ...stats,
    error: errors.length > 0 ? errors.join(" | ") : null,
  });
  console.log(
    `[worker] done in ${Math.round((Date.now() - startedAt) / 1000)}s:`,
    stats,
    errors.length > 0 ? { errors } : "",
  );
  if (errors.length > 0) process.exitCode = 1;

  await pool.end();
}

main();
