import type { Pool } from "pg";
import { fetchOpenSettlementLeadUrls, fetchLeadDetails, type AggregatorLead } from "./aggregator.js";
import { fetchClassActionOrgLeads } from "./classActionOrgSource.js";
import {
  findDocketByCaseIdentifier,
  extractDocketNumberFromText,
  caseNamesLikelyMatch,
} from "./courtlistener.js";
import { isKnownAdministratorDomain, isBoilerplateDomain } from "./keywords.js";
import { deriveStatusAndStage } from "./status.js";
import { findMatchingSettlement, upsertSettlement, recordSource } from "./repository.js";
import { DATE_PATTERN, parseDateToken } from "./dates.js";
import type { RunStats } from "./discover.js";

const AGGREGATOR_LEADS_PER_RUN = Number(process.env.AGGREGATOR_LEADS_PER_RUN ?? 3);
// Split (not duplicated) across sources: both still share the same 5
// req/min CourtListener budget this worker is already careful not to hog
// (see courtlistener.ts), so adding a second lead source must not simply
// double how many CourtListener calls one run makes. No floor here - an
// operator setting AGGREGATOR_LEADS_PER_RUN=0 to pause this discovery path
// must still get zero leads from either source, not one each.
const PER_SOURCE_LEADS = Math.ceil(AGGREGATOR_LEADS_PER_RUN / 2);

/**
 * One pending lead from either source, resolved to a common shape before
 * the verification pipeline below (which doesn't care which source it
 * came from). Top Class Actions only gives a listing URL up front — its
 * actual fields require a second per-lead fetch (fetchLeadDetails) — while
 * classaction.org's listing already includes everything in one pass.
 */
type PendingLead =
  | { source: "tca"; identifier: string }
  | { source: "classActionOrg"; identifier: string; lead: AggregatorLead };

async function resolveLead(pending: PendingLead): Promise<AggregatorLead | null> {
  if (pending.source === "tca") return fetchLeadDetails(pending.identifier);
  return pending.lead;
}

/**
 * Settlement-administrator sites commonly disclose the underlying court
 * case number somewhere on their own page (often required as part of the
 * class notice) even when the lead source that pointed us here didn't
 * supply one structurally - this is classaction.org's listing's one real
 * gap next to Top Class Actions'. Used as a last resort before
 * findDocketByCaseIdentifier falls back to its much weaker case-name-only
 * search, which struggles against a marketing-style settlement title that
 * doesn't share real plaintiff/defendant wording with the actual caption.
 */
// Deliberately silent on any failure (network error, timeout, a site
// blocking a plain fetch) rather than surfacing it to leadErrors: unlike
// the CourtListener calls elsewhere in this file, this hits a different
// third-party domain per lead with no shared budget to protect, and it's
// already just a best-effort layer on top of the safe (if weaker)
// case-name fallback findDocketByCaseIdentifier falls back to on its own -
// a failure here never causes an unverified lead to be skipped outright,
// only to be matched more conservatively.
async function tryExtractDocketNumberFromOfficialSite(
  url: string,
): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return extractDocketNumberFromText(await response.text());
  } catch {
    return null;
  }
}

/** "10/20/2026" or "March 15, 2027" -> Date; "Varies", "N/A", empty, unparseable -> null. */
function parseUsDate(text: string | null): Date | null {
  if (!text) return null;
  const match = DATE_PATTERN.exec(text);
  if (!match) return null;
  return parseDateToken(match[0]);
}

function isNoProofNeeded(text: string | null): boolean {
  if (!text) return true;
  return /^(n\/a|none|no proof|not required)/i.test(text.trim());
}

/**
 * Secondary discovery path: public settlement-tracking sites (Top Class
 * Actions, classaction.org) as LEAD sources only. Every fact this finds
 * still goes through the same verification model as the CourtListener-text
 * path — a lead's own official-site domain only earns "verified" if it's
 * on the known-administrator allowlist; otherwise it's "probable" with the
 * source disclosed plainly, exactly like any other unverified find. We
 * never treat a lead source's own description as ground truth — we
 * cross-reference the case against CourtListener's own docket index
 * (public even when documents are paywalled) so every published
 * settlement still links to a real docket, and we skip any lead we can't
 * match to one rather than inventing a case page for it.
 */
export async function runAggregatorDiscovery(
  pool: Pool,
  stats: RunStats,
): Promise<string[]> {
  const [tcaUrls, classActionOrgLeads] = await Promise.all([
    fetchOpenSettlementLeadUrls(PER_SOURCE_LEADS),
    fetchClassActionOrgLeads(PER_SOURCE_LEADS),
  ]);
  const pendingLeads: PendingLead[] = [
    ...tcaUrls.map((url): PendingLead => ({ source: "tca", identifier: url })),
    ...classActionOrgLeads.map(
      (lead): PendingLead => ({ source: "classActionOrg", identifier: lead.sourceUrl, lead }),
    ),
  ];
  // Collected (not just console.error'd) so a run where every lead fails -
  // e.g. the shared CourtListener budget being exhausted - shows up in the
  // stored worker_runs record that monitoring actually looks at, not just
  // in ephemeral process logs. See index.ts, which folds these into the
  // same `errors` list the other discovery paths report through.
  const leadErrors: string[] = [];

  for (const pending of pendingLeads) {
    // Same spirit as discover.ts's per-docket isolation: one lead failing
    // (a CourtListener rate-limit hit on the docket cross-reference, a
    // parse error, whatever) must not abort the rest of this run's leads.
    try {
      const lead = await resolveLead(pending);
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

      // A docket number straight from the lead source's own structured
      // fields (TCA) is trustworthy enough that matching on the number
      // alone is fine, same as it's always been. A number pulled out of
      // free text on the official site is not: that text could just as
      // easily be naming a *different*, unrelated case the same
      // administrator also handles, and findDocketByCaseIdentifier's
      // number branch matches on the number alone with no case-name
      // cross-check. So an extracted number additionally requires the
      // matched docket's own case name to still plausibly be this lead's
      // case before it's trusted - see below.
      const leadDocketNumber = lead.docketNumber?.trim() ? lead.docketNumber : null;
      const extractedDocketNumber = leadDocketNumber
        ? null
        : await tryExtractDocketNumberFromOfficialSite(officialUrl);

      const docket = await findDocketByCaseIdentifier({
        docketNumber: leadDocketNumber ?? extractedDocketNumber,
        caseName: lead.caseName,
      });
      // Can't route to a /case/[id] page without a real docket match — skip
      // rather than invent one. This is the honest limit of "lead source,
      // independently cross-referenced."
      if (!docket) continue;
      if (
        extractedDocketNumber &&
        !caseNamesLikelyMatch(docket.caseName, lead.caseName ?? "")
      ) {
        continue;
      }

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
        // Prefer the matched docket's own (verified) number over whatever
        // we searched with - important for extractedDocketNumber, which
        // could in principle differ from the real docket's number if the
        // match actually came through the case-name fallback rather than
        // the number itself.
        docketNumber: docket.docketNumber ?? leadDocketNumber ?? extractedDocketNumber,
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
        matchedKeyword: `aggregator lead (${pending.source}): ${lead.title ?? pending.identifier}`,
        snippet: pending.identifier,
      });
    } catch (err) {
      console.error(
        `[aggregator] failed to process lead (${pending.source}) ${pending.identifier}:`,
        err,
      );
      leadErrors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return leadErrors;
}
