"use client";

import Link from "next/link";
import { useState } from "react";
import type { ClaimRequestStatus } from "@/lib/members/types";

const STATUS_LABELS: Record<ClaimRequestStatus, string> = {
  requested: "Requested — we'll review and let you know what's needed",
  awaiting_documents: "Waiting on documents from you",
  ready_to_file: "Ready — we'll file this claim shortly",
  filed: "Filed with the settlement administrator",
  rejected: "Not able to file this one",
  withdrawn: "Withdrawn",
};

export default function ClaimFilingCTA({
  settlementId,
  currentPath,
  isSignedIn,
  hasAuthorized,
  initialStatus,
}: {
  settlementId: number;
  currentPath: string;
  isSignedIn: boolean;
  hasAuthorized: boolean;
  initialStatus: ClaimRequestStatus | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isSignedIn) {
    return (
      <p className="claim-filing-cta">
        <Link href={`/login?next=${encodeURIComponent(currentPath)}`}>
          Log in
        </Link>{" "}
        to have us file this claim for you (a preparation fee applies).
      </p>
    );
  }

  if (!hasAuthorized) {
    return (
      <p className="claim-filing-cta">
        <Link href={`/authorize?next=${encodeURIComponent(currentPath)}`}>
          Sign the one-time filing authorization
        </Link>{" "}
        to have us file this claim for you.
      </p>
    );
  }

  if (status) {
    return (
      <p className="claim-filing-cta">
        Filing request status: {STATUS_LABELS[status]} —{" "}
        <Link href="/account">manage documents</Link>
      </p>
    );
  }

  async function requestFiling() {
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/claim-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settlementId }),
    });
    const body = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      return;
    }
    setStatus(body.claimRequest.status);
  }

  return (
    <div className="claim-filing-cta">
      <button type="button" onClick={requestFiling} disabled={submitting}>
        {submitting ? "Requesting…" : "Have us file this claim for you"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
