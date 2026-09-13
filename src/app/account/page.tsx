import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/members/auth";
import {
  getLatestAuthorization,
  listClaimRequestsForMember,
  listDocumentsForMember,
} from "@/lib/members/repository";
import { getSettlementsByIds } from "@/lib/settlements/repository";
import DocumentUploadForm from "../components/DocumentUploadForm";
import LogoutButton from "../components/LogoutButton";

const STATUS_LABELS: Record<string, string> = {
  requested: "Requested — we'll review and let you know what's needed",
  awaiting_documents: "Waiting on documents from you",
  ready_to_file: "Ready — we'll file this claim shortly",
  filed: "Filed with the settlement administrator",
  rejected: "Not able to file this one",
  withdrawn: "Withdrawn",
};

export default async function AccountPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login?next=/account");

  const [authorization, claimRequests, documents] = await Promise.all([
    getLatestAuthorization(member.id),
    listClaimRequestsForMember(member.id),
    listDocumentsForMember(member.id),
  ]);

  const settlements = await getSettlementsByIds(
    claimRequests.map((r) => r.settlement_id),
  );
  const settlementById = new Map(settlements.map((s) => [s.id, s]));

  const hasGovernmentId = documents.some((d) => d.doc_type === "government_id");
  const hasClaimProof = documents.some((d) => d.doc_type === "claim_proof");

  return (
    <main className="page">
      <Link href="/" className="back-link">
        ← Back to search
      </Link>

      <div className="account-header">
        <h1>Your account</h1>
        <LogoutButton />
      </div>
      <p className="subtitle">{member.email}</p>

      <section className="account-section">
        <h2>Claim-filing authorization</h2>
        {authorization ? (
          <p>
            Signed by {authorization.signed_name} on{" "}
            {new Date(authorization.agreed_at).toLocaleDateString()}.
          </p>
        ) : (
          <p>
            Not signed yet.{" "}
            <Link href="/authorize">Sign the authorization</Link> before
            requesting help with a claim.
          </p>
        )}
      </section>

      <section className="account-section">
        <h2>Your documents</h2>
        <p className="subtitle">
          Upload these once — we&apos;ll reuse them for every claim you ask
          us to help file.
        </p>
        <div className="document-upload-list">
          <div>
            {hasGovernmentId && <span className="doc-status-ok">Uploaded ✓</span>}
            <DocumentUploadForm docType="government_id" />
          </div>
          <div>
            {hasClaimProof && <span className="doc-status-ok">Uploaded ✓</span>}
            <DocumentUploadForm docType="claim_proof" />
          </div>
        </div>
      </section>

      <section className="account-section">
        <h2>Claims you&apos;ve asked us to help file</h2>
        {claimRequests.length === 0 ? (
          <p>
            None yet. Find a settlement on a case page and request help
            filing it.
          </p>
        ) : (
          <ul className="claim-request-list">
            {claimRequests.map((request) => {
              const settlement = settlementById.get(request.settlement_id);
              return (
                <li key={request.id} className="claim-request-item">
                  {settlement ? (
                    <Link href={`/case/${settlement.courtlistener_docket_id}`}>
                      {settlement.case_name ?? `Settlement #${request.settlement_id}`}
                    </Link>
                  ) : (
                    <span>Settlement #{request.settlement_id}</span>
                  )}
                  <p className="claim-request-status">
                    {STATUS_LABELS[request.status] ?? request.status}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
