import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSettlementById } from "@/lib/settlements/repository";
import { loadMemberClaimState } from "@/lib/members/claimState";
import SettlementCard from "../../case/[id]/SettlementCard";

/**
 * Detail page for a settlement that hasn't (or hasn't yet) been matched to
 * a real CourtListener docket — see discoverFromAggregator.ts. /case/[id]
 * can't be it: that page IS a court docket page, routed by docket id, and
 * there's no docket here to route to. This page shows the settlement's
 * own facts instead (as reported by the public tracker that listed it),
 * clearly labeled unverified, and still offers the same filing-request
 * flow as a verified settlement (SettlementCard handles both identically).
 */
export default async function SettlementListingPage({
  params,
}: PageProps<"/listing/[id]">) {
  const { id } = await params;
  const settlementId = Number(id);
  if (!Number.isInteger(settlementId)) notFound();

  const settlement = await getSettlementById(settlementId);
  if (!settlement) notFound();

  // A later worker run may since have matched this exact settlement to a
  // real docket (see findMatchingSettlement's domain-based upgrade path) —
  // if so this settlement's real page is now /case/[docketId], and an old
  // link to this URL should hand off there instead of showing a stale
  // "unverified" view.
  if (settlement.courtlistener_docket_id !== null) {
    redirect(`/case/${settlement.courtlistener_docket_id}`);
  }

  const currentPath = `/listing/${id}`;

  const { memberId, hasAuthorized, claimRequestStatusBySettlement } =
    await loadMemberClaimState([settlement], `settlement ${settlement.id}`);

  return (
    <main className="page">
      <Link href="/" className="back-link">
        ← Back to search
      </Link>

      <p className="unverified-listing-banner">
        This settlement was found via a public settlement tracker and
        hasn&apos;t yet been independently matched to a court record. This
        page will update automatically if that changes.
      </p>

      <h1>{settlement.case_name ?? "Untitled settlement"}</h1>

      <section className="settlements">
        <SettlementCard
          settlement={settlement}
          currentPath={currentPath}
          isSignedIn={memberId !== null}
          hasAuthorized={hasAuthorized}
          claimRequestStatus={claimRequestStatusBySettlement.get(settlement.id) ?? null}
        />
      </section>
    </main>
  );
}
