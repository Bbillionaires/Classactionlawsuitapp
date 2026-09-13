import Link from "next/link";
import { listOpenSettlements } from "@/lib/settlements/repository";
import type { Settlement } from "@/lib/settlements/types";

const PROMO_MESSAGES = [
  "Claim your class action lawsuit now",
  "Want to start a class action lawsuit?",
  "Join ClassActionPayouts.com now to claim your payout",
  "Would you like help claiming your class action payout?",
];
// Non-breaking spaces: plain spaces collapse to one in HTML, and this
// needs to visibly show several between each message, per spec.
const PROMO_SEPARATOR = "     $     ";

/**
 * Shown in place of the open-claims list when there are none yet — still
 * scrolls like the rest of the ticker, just with promotional copy
 * instead of real settlements, so the strip is never a dead static bar.
 */
function PromoTicker() {
  const set = (
    <span className="ticker-item ticker-promo">
      {PROMO_MESSAGES.map((message, i) => (
        <span key={i}>
          <Link href="/signup">{message}</Link>
          {PROMO_SEPARATOR}
        </span>
      ))}
    </span>
  );

  return (
    <div className="ticker">
      <div className="ticker-track">
        <div className="ticker-set">{set}</div>
        <div className="ticker-set" aria-hidden="true">
          {set}
        </div>
      </div>
    </div>
  );
}

/**
 * A news-ticker-style strip of open (status: "active") settlements,
 * shown on every page between the header and the page content. Pure CSS
 * marquee — no client JS needed, since the scroll is just a looping
 * translateX animation.
 */
export default async function OpenClaimsTicker() {
  let settlements: Settlement[];
  try {
    settlements = await listOpenSettlements({ limit: 20 });
  } catch (error) {
    console.error("Failed to load ticker settlements:", error);
    settlements = [];
  }

  if (settlements.length === 0) {
    return <PromoTicker />;
  }

  const items = settlements.map((s) => (
    <Link
      key={s.id}
      href={`/case/${s.courtlistener_docket_id}`}
      className="ticker-item"
    >
      🟢 OPEN — {s.case_name ?? "Untitled case"}
      {s.settlement_amount ? ` · ${s.settlement_amount}` : ""}
      {s.claim_deadline
        ? ` · claim by ${new Date(s.claim_deadline).toLocaleDateString()}`
        : ""}
    </Link>
  ));

  return (
    <div className="ticker">
      {/* Content is duplicated so the CSS animation can loop seamlessly
          from -50% back to 0 with no visible seam. */}
      <div className="ticker-track">
        <div className="ticker-set">{items}</div>
        <div className="ticker-set" aria-hidden="true">
          {items}
        </div>
      </div>
    </div>
  );
}
