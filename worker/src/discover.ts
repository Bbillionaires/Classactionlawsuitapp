import type { Pool } from "pg";
import {
  fetchNewestClassActionDockets,
  fetchDocketEntries,
  fetchDocumentPlainText,
} from "./courtlistener.js";
import {
  matchesSettlementKeyword,
  matchesKnownAdministrator,
  administratorNameForDomain,
} from "./keywords.js";
import { extractCandidateUrls, scoreUrl } from "./extract.js";
import { deriveStatusAndStage } from "./status.js";
import { findMatchingSettlement, upsertSettlement, recordSource } from "./repository.js";

const DOCKETS_PER_RUN = Number(process.env.DOCKETS_PER_RUN ?? 5);
const MAX_DOCUMENTS_PER_RUN = Number(process.env.MAX_DOCUMENTS_PER_RUN ?? 5);

export interface RunStats {
  docketsScanned: number;
  candidatesFound: number;
  settlementsCreated: number;
  settlementsUpdated: number;
}

/**
 * One discovery pass: pulls the newest class-action dockets, scans their
 * entries for settlement-related keywords, extracts and scores any URLs
 * found (in the entry text itself, or — budget permitting — in an
 * attached document's text), and upserts what it finds.
 *
 * Deliberately small per run (a handful of dockets, a handful of
 * documents): this shares a 5 req/min CourtListener token with the live
 * site and must never be the reason a real visitor gets rate-limited.
 */
export async function runDiscovery(pool: Pool): Promise<RunStats> {
  const stats: RunStats = {
    docketsScanned: 0,
    candidatesFound: 0,
    settlementsCreated: 0,
    settlementsUpdated: 0,
  };

  const dockets = await fetchNewestClassActionDockets(DOCKETS_PER_RUN);
  let documentsFetched = 0;

  for (const docket of dockets) {
    stats.docketsScanned += 1;

    let entries;
    try {
      entries = await fetchDocketEntries(docket.docket_id);
    } catch (err) {
      console.error(
        `[discover] failed to fetch entries for docket ${docket.docket_id}:`,
        err,
      );
      continue;
    }

    for (const entry of entries) {
      // Two independent triggers: the 16-item settlement-keyword list, and
      // a direct mention of a known administrator (by domain or display
      // name) — a docket entry can name an administrator without using
      // any of our keyword phrases verbatim.
      const keyword = matchesSettlementKeyword(entry.description);
      const adminMatch = matchesKnownAdministrator(entry.description);
      if (!keyword && !adminMatch) continue;

      const matchLabel = keyword
        ? `keyword "${keyword}"`
        : `administrator "${adminMatch!.name}"`;
      const isCourtOrder = /\border\b/i.test(entry.description);
      const candidates = extractCandidateUrls(entry.description);

      if (candidates.length === 0 && documentsFetched < MAX_DOCUMENTS_PER_RUN) {
        for (const doc of entry.recap_documents) {
          if (documentsFetched >= MAX_DOCUMENTS_PER_RUN) break;
          if (!doc.is_available) continue; // not mirrored to RECAP; nothing to scan
          documentsFetched += 1;
          const text = await fetchDocumentPlainText(doc.id);
          if (text) candidates.push(...extractCandidateUrls(text));
        }
      }

      for (const candidate of candidates) {
        stats.candidatesFound += 1;

        const administrator =
          administratorNameForDomain(candidate.domain) ?? adminMatch?.name ?? null;
        const score = scoreUrl({
          domain: candidate.domain,
          foundInCourtOrder: isCourtOrder,
          matchedKeyword: matchLabel,
        });

        const existing = await findMatchingSettlement(pool, docket.docket_id, {
          domain: candidate.domain,
          administrator,
        });

        const { status, stage } = deriveStatusAndStage({
          hasWebsite: true,
          claimDeadline: null,
          finalApprovalDate: null,
        });

        const settlementId = await upsertSettlement(pool, existing, {
          courtlistenerDocketId: docket.docket_id,
          caseName: docket.caseName,
          docketNumber: docket.docketNumber,
          courtId: docket.court_id,
          settlementWebsiteUrl: candidate.url,
          settlementWebsiteDomain: candidate.domain,
          settlementAdministrator: administrator,
          status,
          stage,
          verificationStatus: score.verificationStatus,
          verificationSource: score.verificationSource,
          confidenceScore: score.confidenceScore,
        });

        if (existing) stats.settlementsUpdated += 1;
        else stats.settlementsCreated += 1;

        await recordSource(pool, settlementId, {
          extractedField: "settlement_website_url",
          extractedValue: candidate.url,
          courtlistenerDocketEntryId: entry.id,
          matchedKeyword: matchLabel,
          snippet: entry.description.slice(0, 500),
        });
      }
    }
  }

  return stats;
}
