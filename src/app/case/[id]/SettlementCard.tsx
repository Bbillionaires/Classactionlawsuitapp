import type { Settlement } from "@/lib/settlements/types";

const STAGE_LABELS: Record<Settlement["stage"], string> = {
  pending: "Settlement proposed",
  final_approval_pending: "Awaiting final approval",
  active: "Claims open",
  payments_pending: "Payments pending",
  paid_distributed: "Paid / distributed",
  closed: "Closed",
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function SettlementCard({
  settlement,
}: {
  settlement: Settlement;
}) {
  const {
    status,
    stage,
    settlement_administrator,
    settlement_website_url,
    claim_form_url,
    settlement_amount,
    estimated_award,
    claim_deadline,
    objection_deadline,
    opt_out_deadline,
    final_approval_hearing_date,
    class_definition,
    proof_requirements,
    verification_status,
    verification_source,
    last_verified_at,
  } = settlement;

  const claimUrl = claim_form_url ?? settlement_website_url;
  const isVerified = verification_status === "verified";
  const importantDates: Array<[string, string | null]> = [
    ["Claim deadline", claim_deadline],
    ["Objection deadline", objection_deadline],
    ["Opt-out deadline", opt_out_deadline],
    ["Final approval hearing", final_approval_hearing_date],
  ].filter(([, date]) => date) as Array<[string, string]>;

  return (
    <div className="settlement-card">
      <div className="settlement-header">
        <span className={`status-badge status-${status}`}>{status}</span>
        <span className="settlement-stage">{STAGE_LABELS[stage]}</span>
      </div>

      <dl className="case-facts">
        {settlement_amount && (
          <div>
            <dt>Settlement amount</dt>
            <dd>{settlement_amount}</dd>
          </div>
        )}
        {estimated_award && (
          <div>
            <dt>Estimated award</dt>
            <dd>{estimated_award}</dd>
          </div>
        )}
        {settlement_administrator && (
          <div>
            <dt>Settlement administrator</dt>
            <dd>{settlement_administrator}</dd>
          </div>
        )}
      </dl>

      {class_definition && (
        <p className="settlement-detail">
          <strong>Who qualifies:</strong> {class_definition}
        </p>
      )}
      {proof_requirements && (
        <p className="settlement-detail">
          <strong>Proof required:</strong> {proof_requirements}
        </p>
      )}

      {importantDates.length > 0 && (
        <ul className="settlement-dates">
          {importantDates.map(([label, date]) => (
            <li key={label}>
              <strong>{label}:</strong> {formatDate(date)}
            </li>
          ))}
        </ul>
      )}

      {claimUrl &&
        (isVerified ? (
          <a
            className="file-claim-button"
            href={claimUrl}
            target="_blank"
            rel="noreferrer"
          >
            File a Claim ↗
          </a>
        ) : (
          <p className="settlement-unverified">
            Possible settlement site found —{" "}
            <a href={claimUrl} target="_blank" rel="noreferrer">
              {claimUrl}
            </a>{" "}
            <em>({verification_status}, not confirmed — verify independently
            before submitting any personal information)</em>
          </p>
        ))}

      <p className="settlement-provenance">
        {verification_source}
        {last_verified_at &&
          ` · last checked ${formatDate(last_verified_at)}`}
      </p>
    </div>
  );
}
