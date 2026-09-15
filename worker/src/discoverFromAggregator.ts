import type { Pool } from "pg";
import { fetchOpenSettlementLeadUrls, fetchLeadDetails } from "./aggregator.js";
import { findDocketByCaseIdentifier } from "./courtlistener.js";
import { isKnownAdministratorDomain, isBoilerplateDomain } from "./keywords.js";
import { deriveStatusAndStage } from "./status.js";
import { findMatchingSettlement, upsertSettlement, recordSource } from "./repository.js";
import type { RunStats } from "./discover.js";

const AGGREGATOR_LEADS_PER_RUN = Number(process.env.AGGREGATOR_LEADS_PER_RUN ?? 3);

/** "10/20/2026" -> Date; "Varies", "N/A", empty, unparseable -> null. */
function parseUsDate(text: string | null): Date | null {
  if (!text) return null;
  const match = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, month, day, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isNoProofNeeded(text: string | null): boolean {
  if (!text) return true;
  return /^(n\/a|none|no proof|not required)/i.test(text.trim());
}

/**
 * Secondary discovery path: Top Class Actions as a LEAD source only.
 * Every fact this finds still goes through the same verification model
 * as the CourtListener-text path — a lead's own official-site domain
 * only earns "verified" if it's on the known-administrator allowlist;
 * otherwise it's "probable" with the source disclosed plainly, exactly
 * like any other unverified find. We never treat TCA's own description
 * as ground truth — we cross-reference the case against CourtListener's
 * own docket index (public even when documents are paywalled) so every
 * published settlement still links to a real docket, and we skip any
 * lead we can't match to one rather than inventing a case page for it.
 */
export async function runAggregatorDiscovery(
  pool: Pool,
  stats: RunStats,
): Promise<void> {
  const leadUrls = await fetchOpenSettlementLeadUrls(AGGREGATOR_LEADS_PER_RUN);

  for (const leadUrl of leadUrls) {
    let lead;
    try {
      lead = await fetchLeadDetails(leadUrl);
    } catch (err) {
      console.error(`[aggregator] failed to fetch lead ${leadUrl}:`, err);
      continue;
    }
    if (!lead) continue;

    const officialUrl = lead.settlementWebsiteUrl ?? lead.claimFormUrl;
    if (!officialUrl) continue; // nothing to verify or link to

    let domain: string;
    try {
      domain = new URL(officialUrl).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (isBoilerplateDomain(domain)) continue;

    const docket = await findDocketByCaseIdentifier({
      docketNumber: lead.docketNumber,
      caseName: lead.caseName,
    });
    // Can't route to a /case/[id] page without a real docket match — skip
    // rather than invent one. This is the honest limit of "lead source,
    // independently cross-referenced."
    if (!docket) continue;

    stats.docketsScanned += 1;
    stats.candidatesFound += 1;

    const isKnown = isKnownAdministratorDomain(domain);
    const verificationStatus = isKnown ? "verified" : "probable";
    const confidenceScore = isKnown ? 80 : 50;
    const verificationSource = isKnown
      ? "known settlement administrator domain (found via public settlement tracker)"
      : "found via public settlement tracker, matched to a real CourtListener docket — domain not independently recognized, verify before filing";

    const claimDeadline = parseUsDate(lead.exclusionDeadline);
    const finalApprovalHearingDate = parseUsDate(lead.finalHearingDate);
    const { status, stage } = deriveStatusAndStage({
      hasWebsite: true,
      claimDeadline,
      finalApprovalDate: finalApprovalHearingDate,
    });

    const existing = await findMatchingSettlement(pool, docket.docket_id, {
      domain,
      administrator: lead.administratorText,
    });

    const settlementId = await upsertSettlement(pool, existing, {
      courtlistenerDocketId: docket.docket_id,
      caseName: lead.caseName ?? docket.caseName,
      docketNumber: lead.docketNumber ?? docket.docketNumber,
      courtId: docket.court_id,
      settlementWebsiteUrl: officialUrl,
      settlementWebsiteDomain: domain,
      settlementAdministrator: lead.administratorText,
      claimFormUrl: lead.claimFormUrl,
      settlementAmount: lead.potentialAward,
      estimatedAward: lead.potentialAward,
      claimDeadline,
      finalApprovalHearingDate,
      classDefinition: lead.classDefinition,
      proofRequirements: isNoProofNeeded(lead.proofRequired) ? null : lead.proofRequired,
      status,
      stage,
      verificationStatus,
      verificationSource,
      confidenceScore,
    });

    if (existing) stats.settlementsUpdated += 1;
    else stats.settlementsCreated += 1;

    await recordSource(pool, settlementId, {
      extractedField: "settlement_website_url",
      extractedValue: officialUrl,
      courtlistenerDocketEntryId: null,
      matchedKeyword: `aggregator lead: ${lead.title ?? leadUrl}`,
      snippet: leadUrl,
    });
  }
}
