"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Settlement } from "@/lib/settlements/types";

type ProofFilter = "any" | "required" | "not_required";

const PROOF_LABELS: Record<ProofFilter, string> = {
  any: "All open claims",
  required: "Need proof",
  not_required: "No proof needed",
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function OpenClaimsSection() {
  const [proof, setProof] = useState<ProofFilter>("any");
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/settlements/open?proof=${proof}`)
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setSettlements(body.settlements);
      })
      .catch(() => {
        if (!cancelled) setSettlements([]);
      });
    return () => {
      cancelled = true;
    };
  }, [proof]);

  return (
    <section className="open-claims">
      <h2>Open Class Action Claims</h2>
      <p className="subtitle">
        Settlements currently accepting claims — these are what most
        visitors are actually looking for.
      </p>

      <div className="open-claims-filters">
        {(Object.keys(PROOF_LABELS) as ProofFilter[]).map((key) => (
          <button
            key={key}
            type="button"
            className={proof === key ? "filter-chip filter-chip-active" : "filter-chip"}
            onClick={() => setProof(key)}
          >
            {PROOF_LABELS[key]}
          </button>
        ))}
      </div>

      {settlements === null && <p className="result-count">Loading open claims…</p>}

      {settlements && settlements.length === 0 && (
        <p className="result-count">
          No open claims match this filter yet. New settlements are
          discovered automatically — check back soon.
        </p>
      )}

      {settlements && settlements.length > 0 && (
        <ul className="results open-claims-list">
          {settlements.map((s) => (
            <li key={s.id} className="result open-claim-card">
              <div className="result-title">
                <span className="status-badge status-active">Open</span>
                <Link href={`/case/${s.courtlistener_docket_id}`}>
                  {s.case_name ?? "Untitled case"}
                </Link>
              </div>
              <div className="result-meta">
                {s.settlement_amount && <span>{s.settlement_amount}</span>}
                {s.estimated_award && <span>Est. award: {s.estimated_award}</span>}
                {s.claim_deadline && (
                  <span>Claim by {formatDate(s.claim_deadline)}</span>
                )}
                <span>
                  {s.proof_requirements ? "Proof required" : "No proof needed"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
