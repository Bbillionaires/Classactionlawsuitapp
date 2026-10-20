import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CourtListenerApiError,
  type CourtListenerDocketEntry,
  getDocketById,
  getDocketEntries,
} from "@/lib/courtlistener";
import { getSettlementsForDocket } from "@/lib/settlements/repository";
import type { Settlement } from "@/lib/settlements/types";
import { loadMemberClaimState } from "@/lib/members/claimState";
import SettlementCard from "./SettlementCard";

/**
 * CourtListener is temporarily unreachable (rate-limited, or erroring on
 * their end) - not the same as the docket genuinely not existing (a real
 * 404, handled separately). Rather than showing visitors a dead end with
 * backend details they have no use for, fall back to whatever we already
 * know about this docket's settlement(s) from our own database, which
 * doesn't depend on CourtListener being reachable at all.
 */
async function LiveRecordUnavailable({ docketId }: { docketId: string }) {
  let settlements: Settlement[] = [];
  try {
    settlements = await getSettlementsForDocket(docketId);
  } catch (error) {
    console.error(
      `Failed to load settlements for docket ${docketId} during live-record fallback:`,
      error,
    );
  }

  // Nothing to render SettlementCard for below - skip the member/auth
  // lookup entirely rather than doing it on a page that's already
  // degraded because an external dependency is down.
  const { memberId, hasAuthorized, claimRequestStatusBySettlement } =
    settlements.length > 0
      ? await loadMemberClaimState(settlements, `docket ${docketId} (live record unavailable)`)
      : { memberId: null, hasAuthorized: false, claimRequestStatusBySettlement: new Map() };

  return (
    <main className="page">
      <Link href="/" className="back-link">
        ← Back to search
      </Link>

      {/* Deliberately not .unverified-listing-banner - that styling means
          "this settlement hasn't been matched to a real court record,"
          which isn't true here (this docket IS real; CourtListener is
          just temporarily unreachable) and would wrongly read as a
          caution about the settlement's legitimacy. */}
      <p className="live-record-unavailable-banner">
        We can&apos;t load the live court record for this case right now
        {settlements.length > 0
          ? ", but here's what we know about the settlement:"
          : ". Please check back again shortly."}
      </p>

      {settlements.length > 0 && (
        <section className="settlements">
          {settlements.map((settlement) => (
            <SettlementCard
              key={settlement.id}
              settlement={settlement}
              currentPath={`/case/${docketId}`}
              isSignedIn={memberId !== null}
              hasAuthorized={hasAuthorized}
              claimRequestStatus={
                claimRequestStatusBySettlement.get(settlement.id) ?? null
              }
            />
          ))}
        </section>
      )}
    </main>
  );
}

function entryDescription(entry: CourtListenerDocketEntry): string {
  if (entry.description) return entry.description;
  const docDescription = entry.recap_documents.find((d) => d.description)
    ?.description;
  return docDescription || "No description available.";
}

export default async function CasePage({ params }: PageProps<"/case/[id]">) {
  const { id } = await params;

  // Fetched separately, not as one Promise.all: a 404 only ever means the
  // docket itself (not its entries, which have no independent existence
  // check), and entries failing shouldn't throw away a docket we did
  // successfully fetch - bundling them meant a transient entries-only
  // failure both discarded good docket data and could race a genuine
  // docket 404 against an unrelated entries error.
  let docket;
  try {
    docket = await getDocketById(id);
  } catch (error) {
    if (error instanceof CourtListenerApiError) {
      if (error.status === 404) notFound();
      // 429 (rate-limited) or a 5xx on CourtListener's end - the docket
      // itself is presumably fine, we just can't reach it right now.
      if (error.status === 429 || error.status >= 500) {
        return <LiveRecordUnavailable docketId={id} />;
      }
    }
    throw error;
  }

  // Best-effort, like the settlements fetch below: entries are a
  // secondary section of this page, not core to it, so a failure here
  // shouldn't take down a page that otherwise loaded fine.
  let entries: CourtListenerDocketEntry[] = [];
  let entriesUnavailable = false;
  try {
    entries = await getDocketEntries(id);
  } catch (error) {
    console.error(`Failed to load docket entries for docket ${id}:`, error);
    entriesUnavailable = true;
  }

  // Settlement data is a best-effort enrichment on top of CourtListener,
  // not core to the page — a database hiccup here should never break the
  // docket view itself.
  let settlements: Settlement[];
  try {
    settlements = await getSettlementsForDocket(id);
  } catch (error) {
    console.error(`Failed to load settlements for docket ${id}:`, error);
    settlements = [];
  }

  const { memberId, hasAuthorized, claimRequestStatusBySettlement } =
    await loadMemberClaimState(settlements, `docket ${id}`);

  return (
    <main className="page">
      <Link href="/" className="back-link">
        ← Back to search
      </Link>

      <span
        className={`status-badge ${
          docket.date_terminated ? "status-closed" : "status-pending"
        }`}
      >
        {docket.date_terminated ? "Closed" : "Pending"}
      </span>
      <h1>{docket.case_name}</h1>

      <dl className="case-facts">
        <div>
          <dt>Court</dt>
          <dd>{docket.court_id.toUpperCase()}</dd>
        </div>
        {docket.docket_number && (
          <div>
            <dt>Docket No.</dt>
            <dd>{docket.docket_number}</dd>
          </div>
        )}
        {docket.date_filed && (
          <div>
            <dt>Filed</dt>
            <dd>{docket.date_filed}</dd>
          </div>
        )}
        {docket.date_terminated && (
          <div>
            <dt>Terminated</dt>
            <dd>{docket.date_terminated}</dd>
          </div>
        )}
        {docket.cause && (
          <div>
            <dt>Cause</dt>
            <dd>{docket.cause}</dd>
          </div>
        )}
        {docket.nature_of_suit && (
          <div>
            <dt>Nature of suit</dt>
            <dd>{docket.nature_of_suit}</dd>
          </div>
        )}
        {docket.assigned_to_str && (
          <div>
            <dt>Assigned to</dt>
            <dd>{docket.assigned_to_str}</dd>
          </div>
        )}
        {docket.jury_demand && (
          <div>
            <dt>Jury demand</dt>
            <dd>{docket.jury_demand}</dd>
          </div>
        )}
      </dl>

      {settlements.length > 0 && (
        <section className="settlements">
          <h2>{settlements.length > 1 ? "Settlements" : "Settlement"}</h2>
          {settlements.map((settlement) => (
            <SettlementCard
              key={settlement.id}
              settlement={settlement}
              currentPath={`/case/${id}`}
              isSignedIn={memberId !== null}
              hasAuthorized={hasAuthorized}
              claimRequestStatus={
                claimRequestStatusBySettlement.get(settlement.id) ?? null
              }
            />
          ))}
        </section>
      )}

      <a
        className="external-link"
        href={`https://www.courtlistener.com${docket.absolute_url}`}
        target="_blank"
        rel="noreferrer"
      >
        View full docket on CourtListener ↗
      </a>

      <h2 className="entries-heading">Docket entries ({entries.length})</h2>
      {entriesUnavailable && (
        <p className="error">
          Couldn&apos;t load docket entries right now. Please check back
          shortly.
        </p>
      )}
      <ul className="entries">
        {entries.map((entry) => (
          <li key={entry.id} className="entry">
            <div className="entry-header">
              {entry.entry_number != null && (
                <span className="entry-number">#{entry.entry_number}</span>
              )}
              {entry.date_filed && (
                <span className="entry-date">{entry.date_filed}</span>
              )}
            </div>
            <p className="entry-description">{entryDescription(entry)}</p>
            {entry.recap_documents.length > 0 && (
              <ul className="entry-documents">
                {entry.recap_documents.map((doc) => (
                  <li key={doc.id}>
                    <a
                      href={`https://www.courtlistener.com${doc.absolute_url}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {doc.description || "Document"}
                      {doc.page_count != null ? ` (${doc.page_count} pp.)` : ""}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
