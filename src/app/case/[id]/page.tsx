import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CourtListenerApiError,
  type CourtListenerDocketEntry,
  getDocketById,
  getDocketEntries,
} from "@/lib/courtlistener";

function entryDescription(entry: CourtListenerDocketEntry): string {
  if (entry.description) return entry.description;
  const docDescription = entry.recap_documents.find((d) => d.description)
    ?.description;
  return docDescription || "No description available.";
}

export default async function CasePage({ params }: PageProps<"/case/[id]">) {
  const { id } = await params;

  let docket;
  let entries;
  try {
    [docket, entries] = await Promise.all([
      getDocketById(id),
      getDocketEntries(id),
    ]);
  } catch (error) {
    if (error instanceof CourtListenerApiError) {
      if (error.status === 404) notFound();
      if (error.status === 429) {
        return (
          <main className="page">
            <Link href="/" className="back-link">
              ← Back to search
            </Link>
            <p className="error">
              CourtListener is rate-limiting requests right now. Please try
              again in a minute.
            </p>
          </main>
        );
      }
    }
    throw error;
  }

  return (
    <main className="page">
      <Link href="/" className="back-link">
        ← Back to search
      </Link>

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

      <a
        className="external-link"
        href={`https://www.courtlistener.com${docket.absolute_url}`}
        target="_blank"
        rel="noreferrer"
      >
        View full docket on CourtListener ↗
      </a>

      <h2 className="entries-heading">Docket entries ({entries.length})</h2>
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
