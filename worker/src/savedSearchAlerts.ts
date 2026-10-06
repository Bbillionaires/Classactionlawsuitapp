import type { Pool, PoolClient } from "pg";
import { searchDockets, type RecapDocket } from "./courtlistener.js";
import { sendAlertEmail } from "./email.js";

// pg_try_advisory_lock/pg_advisory_unlock are scoped to the specific
// backend session (connection) that calls them, not to a transaction -
// acquiring via one pooled connection and releasing via another (easy to
// do by accident with Pool.query(), which checks a connection out and
// back in per call) would leak the lock on whichever connection actually
// holds it until that connection eventually closes. Every query in a
// given row's critical section below therefore runs on one explicitly
// checked-out client, never Pool.query() directly.
type Queryable = Pool | PoolClient;

const SAVED_SEARCH_ALERTS_PER_RUN = Number(
  process.env.SAVED_SEARCH_ALERTS_PER_RUN ?? 3,
);
// Bounds how many of a search's current results get diffed/seeded per
// check, always taken newest-first. A known, accepted limitation: if a
// saved search is broad enough to pick up more than this many brand-new
// matches between two of its checks (plausible for one left unchecked
// for a while under SAVED_SEARCH_ALERTS_PER_RUN rotation), the oldest of
// that batch can age out of the newest-N window before ever being seen,
// and so never gets alerted. A deliberately generous cap trades a larger
// one-off dedup-check per run for making that in practice rare, without
// resorting to a narrower per-check date window, which would instead risk
// permanently losing a match that failed to send (see sendAlertEmail).
const MAX_RESULTS_PER_CHECK = 50;

export interface SavedSearchAlertStats {
  checked: number;
  alertsSent: number;
}

interface SavedSearchRow {
  id: number;
  query: string;
  court_id: string | null;
  cause: string | null;
  filed_after: string | null;
  filed_before: string | null;
  last_checked_at: string | null;
  member_email: string;
  name: string;
}

function isUndefinedTableError(err: unknown): boolean {
  // saved_searches is owned by the main app's schema
  // (src/lib/members/schema.ts), created lazily on its first web
  // request - if nothing has ever hit that app, the table may not exist
  // yet. Treat that as "nothing to check", not a worker failure.
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "42P01"
  );
}

function formatAlertEmail(
  savedSearchName: string,
  matches: RecapDocket[],
): { subject: string; text: string } {
  const siteUrl = process.env.SITE_URL ?? "https://www.classactionpayouts.com";
  const lines = matches.map(
    (docket) =>
      `- ${docket.caseName}${docket.court_id ? ` (${docket.court_id.toUpperCase()})` : ""}` +
      `${docket.dateFiled ? `, filed ${docket.dateFiled}` : ""}\n  ${siteUrl}/case/${docket.docket_id}`,
  );
  const subject =
    matches.length === 1
      ? `1 new case matches "${savedSearchName}"`
      : `${matches.length} new cases match "${savedSearchName}"`;
  const text =
    `New class action filings match your saved search "${savedSearchName}":\n\n` +
    `${lines.join("\n\n")}\n\n` +
    `You're getting this because email alerts are turned on for this saved search at ${siteUrl}.`;
  return { subject, text };
}

/**
 * Re-runs a bounded, rotating slice of members' saved searches against
 * CourtListener and emails a digest of genuinely new matches. A search's
 * very first check never sends an email - it only seeds the "already
 * seen" baseline from whatever currently matches (the member already
 * saw those results on the search page before saving), so turning on
 * alerts doesn't immediately blast their entire search history.
 */
export async function runSavedSearchAlerts(
  pool: Pool,
): Promise<SavedSearchAlertStats> {
  let rows: SavedSearchRow[];
  try {
    const result = await pool.query<SavedSearchRow>(
      `SELECT ss.id, ss.query, ss.court_id, ss.cause, ss.filed_after,
              ss.filed_before, ss.last_checked_at, ss.name,
              m.email AS member_email
       FROM saved_searches ss
       JOIN members m ON m.id = ss.member_id
       WHERE ss.alerts_enabled
       ORDER BY ss.last_checked_at ASC NULLS FIRST
       LIMIT $1`,
      [SAVED_SEARCH_ALERTS_PER_RUN],
    );
    rows = result.rows;
  } catch (err) {
    if (isUndefinedTableError(err)) return { checked: 0, alertsSent: 0 };
    throw err;
  }

  let alertsSent = 0;

  for (const row of rows) {
    // Each row is independent, same spirit as this worker's other
    // discovery paths (discover.ts, discoverFromAggregator.ts): one
    // saved search erroring (a transient CourtListener hiccup, a query
    // that happens to provoke a non-2xx) must not abort the batch.
    //
    // last_checked_at is only advanced when this row's check actually
    // completed - NOT in a blanket finally. A first-ever check that
    // throws before seeding saved_search_alerts_sent must stay
    // "unchecked" (last_checked_at still null), or the next successful
    // run would wrongly treat it as a normal re-check (isFirstCheck
    // false) against an empty baseline and email-blast the member's
    // entire current match history. Leaving a failed row's
    // last_checked_at untouched also means it sorts first again next
    // run - acceptable (it's retried promptly) since the per-row
    // try/catch already keeps it from blocking any other row in the
    // same batch.
    //
    // An advisory lock on the saved search's own id guards against two
    // overlapping worker runs (an unlikely but real possibility - this
    // worker's one-shot-per-invocation design has no other mutual
    // exclusion) both finding the same new matches and double-emailing
    // the member before either records them as sent. The lock and its
    // release must run on the exact same backend connection (see the
    // Queryable comment above), so this row gets its own dedicated
    // client for its whole critical section rather than pool.query().
    const client = await pool.connect();
    try {
      const lockResult = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS locked",
        [row.id],
      );
      if (!lockResult.rows[0]?.locked) continue;

      try {
        const isFirstCheck = row.last_checked_at === null;

        // Always newest-first here, regardless of whatever sort order the
        // member picked for *displaying* this search on the site (that
        // preference isn't even fetched - see the SELECT above). Checking
        // for new matches is the one place "newest" is the only sort that
        // makes sense: paired with MAX_RESULTS_PER_CHECK, it's what makes
        // "the first N results" a reasonable proxy for "everything filed
        // recently enough to matter."
        const results = await searchDockets({
          query: row.query,
          courtId: row.court_id,
          cause: row.cause,
          filedAfter: row.filed_after,
          filedBefore: row.filed_before,
          sort: "newest",
        });
        const candidates = results.slice(0, MAX_RESULTS_PER_CHECK);

        // Mirrors the comment above: this row only advances past the
        // rotation (last_checked_at) once its check is truly done. A
        // delivery failure isn't - the per-row try/catch alone isn't
        // enough to guarantee that, since sendAlertEmail doesn't throw on
        // a failed send (by design), so the surrounding try block
        // completes normally even when nothing actually got delivered.
        let delayRotation = false;

        if (candidates.length > 0) {
          const newMatches = await findUnsentMatches(client, row.id, candidates);

          if (isFirstCheck) {
            // Seed the baseline from everything currently matching, with
            // no email - the member already saw these on the search page
            // before saving, so turning on alerts shouldn't immediately
            // blast their entire search history.
            if (newMatches.length > 0) await markSent(client, row.id, newMatches);
          } else if (newMatches.length > 0) {
            const { subject, text } = formatAlertEmail(row.name, newMatches);
            const delivered = await sendAlertEmail({ to: row.member_email, subject, text });
            // Only record these as sent once the email actually went out -
            // otherwise a Resend outage or missing config would
            // permanently lose the alert (ON CONFLICT DO NOTHING on a
            // future check would treat it as already-handled even though
            // the member never got it). Leaving it unrecorded means it's
            // simply retried as "new" on this saved search's next check.
            if (delivered) {
              await markSent(client, row.id, newMatches);
              alertsSent += 1;
            } else {
              delayRotation = true;
            }
          }
        }

        if (!delayRotation) {
          await client.query(`UPDATE saved_searches SET last_checked_at = now() WHERE id = $1`, [
            row.id,
          ]);
        }
      } catch (err) {
        console.error(`[savedSearchAlerts] check failed for saved search ${row.id}:`, err);
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [row.id]);
      }
    } finally {
      client.release();
    }
  }

  return { checked: rows.length, alertsSent };
}

/** Of the given candidates, the ones not already recorded as sent/seen for this saved search. */
async function findUnsentMatches(
  db: Queryable,
  savedSearchId: number,
  candidates: RecapDocket[],
): Promise<RecapDocket[]> {
  const docketIds = candidates.map((d) => d.docket_id);
  const existing = await db.query<{ docket_id: number }>(
    `SELECT docket_id FROM saved_search_alerts_sent
     WHERE saved_search_id = $1 AND docket_id = ANY($2::bigint[])`,
    [savedSearchId, docketIds],
  );
  const alreadySeen = new Set(existing.rows.map((r) => r.docket_id));
  return candidates.filter((d) => !alreadySeen.has(d.docket_id));
}

async function markSent(
  db: Queryable,
  savedSearchId: number,
  matches: RecapDocket[],
): Promise<void> {
  const docketIds = matches.map((d) => d.docket_id);
  await db.query(
    `INSERT INTO saved_search_alerts_sent (saved_search_id, docket_id)
     SELECT $1, * FROM UNNEST($2::bigint[])
     ON CONFLICT DO NOTHING`,
    [savedSearchId, docketIds],
  );
}
