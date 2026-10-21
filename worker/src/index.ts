import { pool } from "./db.js";
import { ensureSchema } from "./schema.js";
import { runDiscovery, type RunStats } from "./discover.js";
import { runAggregatorDiscovery } from "./discoverFromAggregator.js";
import { runSavedSearchAlerts } from "./savedSearchAlerts.js";
import { recordWorkerRun, mergeDuplicateSettlements } from "./repository.js";

async function main(): Promise<void> {
  try {
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

    try {
      const merged = await mergeDuplicateSettlements(pool);
      if (merged > 0) {
        console.log(`[worker] merged ${merged} duplicate settlement row(s)`);
      }
    } catch (err) {
      console.error("[worker] duplicate-settlement merge failed:", err);
      errors.push(`Dedupe: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Two independent discovery paths, each allowed to fail without taking
    // the other down with it — a rate-limit hiccup on one shouldn't zero
    // out real results the other path already found this run.
    //
    // Aggregator-lead runs first, not CourtListener text search: both
    // share the same 5 req/min CourtListener budget, and running text
    // search first was letting it spend most of that budget before the
    // lead path got a turn, so a lead's docket cross-reference call
    // landed on an already-exhausted budget on almost every run (see
    // searchFirstDocket's now-fixed silent-null-on-429 bug). The lead
    // path is also the higher-value one per this project's own findings
    // — text search's yield is low by design, which is exactly why the
    // lead path exists — so it gets priority for the budget.
    console.log("[worker] starting aggregator-lead discovery run...");
    try {
      const leadErrors = await runAggregatorDiscovery(pool, stats);
      // Pushed one per failed lead (not joined into one string) so the
      // exit-code check below, which inspects each entry individually,
      // still correctly flips to a real failure if even one of several
      // concurrent lead failures wasn't actually rate-limiting.
      for (const leadError of leadErrors) errors.push(`Aggregator: ${leadError}`);
    } catch (err) {
      console.error("[worker] aggregator discovery failed:", err);
      errors.push(`Aggregator: ${err instanceof Error ? err.message : String(err)}`);
    }

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

    console.log("[worker] checking saved searches for alertable matches...");
    try {
      const alertStats = await runSavedSearchAlerts(pool);
      console.log(
        `[worker] saved-search alerts: checked ${alertStats.checked}, sent ${alertStats.alertsSent}`,
      );
    } catch (err) {
      console.error("[worker] saved-search alerts failed:", err);
      errors.push(`SavedSearchAlerts: ${err instanceof Error ? err.message : String(err)}`);
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
    // A CourtListener 429 means someone else (the live site, most likely)
    // is using the shared rate-limit budget right now - already caught,
    // logged above, and worked around (the other discovery path still
    // ran). That's expected, recoverable real-world behavior, not
    // evidence this deployment is broken, so it shouldn't flip the exit
    // code and turn into a false "deployment failed" signal on Railway
    // every time the budget happens to be busy during a run. Any other
    // kind of error is a real problem and still fails loudly.
    // Match the actual status code this project's CourtListener client
    // always appends at the very end of its error messages ("...: 429"),
    // not just the substring "429" anywhere - a docket ID or sequence
    // number can easily contain "429" by coincidence (e.g. docket 42900123
    // failing with a genuine 500 would otherwise read as rate-limited and
    // get waved through).
    const onlyRateLimited = errors.length > 0 && errors.every((e) => /: 429$/.test(e));
    if (errors.length > 0 && !onlyRateLimited) process.exitCode = 1;
  } finally {
    // Guaranteed even if ensureSchema/recordWorkerRun itself throws -
    // without this, a DB hiccup outside the two discovery try/catches
    // leaks the pool's open sockets and hangs the Railway container
    // instead of exiting.
    await pool.end();
  }
}

main();
