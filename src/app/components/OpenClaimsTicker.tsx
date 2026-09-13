import Link from "next/link";
import { listOpenSettlements } from "@/lib/settlements/repository";
import type { Settlement } from "@/lib/settlements/types";

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
    return (
      <div className="ticker">
        <div className="ticker-track ticker-track-static">
          <span className="ticker-item ticker-empty">
            No open claims discovered yet — new settlements are found
            automatically as they&apos;re filed. Check back soon.
          </span>
        </div>
      </div>
    );
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
