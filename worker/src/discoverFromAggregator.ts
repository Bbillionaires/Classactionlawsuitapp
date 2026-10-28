import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Pool } from "pg";
import { fetchOpenSettlementLeadUrls, fetchLeadDetails, type AggregatorLead } from "./aggregator.js";
import { fetchClassActionOrgLeads } from "./classActionOrgSource.js";
import {
  findDocketByCaseIdentifier,
  extractDocketNumberFromText,
  caseNamesLikelyMatch,
  type RecapDocket,
} from "./courtlistener.js";
import { isKnownAdministratorDomain, isBoilerplateDomain } from "./keywords.js";
import { deriveStatusAndStage } from "./status.js";
import { findSettlementBySourceIdentifier, upsertSettlement, recordSource } from "./repository.js";
import { DATE_PATTERN, parseDateToken } from "./dates.js";
import type { RunStats } from "./discover.js";

const AGGREGATOR_LEADS_PER_RUN = Number(process.env.AGGREGATOR_LEADS_PER_RUN ?? 3);
// Split (not duplicated) across sources: both still share the same 5
// req/min CourtListener budget this worker is already careful not to hog
// (see courtlistener.ts), so adding a second lead source must not simply
// double how many CourtListener calls one run makes. No floor here - an
// operator setting AGGREGATOR_LEADS_PER_RUN=0 to pause this discovery path
// must still get zero leads from either source, not one each.
//
// ceil for one source and floor for the other (not ceil for both) so the
// two shares always sum to exactly AGGREGATOR_LEADS_PER_RUN - ceil'ing
// both let an odd budget (e.g. the default of 3) silently become 4 leads
// total, one more CourtListener cross-reference call than configured.
const TCA_LEADS_PER_RUN = Math.ceil(AGGREGATOR_LEADS_PER_RUN / 2);
const CLASS_ACTION_ORG_LEADS_PER_RUN = Math.floor(AGGREGATOR_LEADS_PER_RUN / 2);

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
 * True if `ip` falls in a loopback, link-local (this covers the
 * 169.254.169.254 cloud metadata address every major provider uses), or
 * RFC1918 private range. Deliberately fails closed on anything it can't
 * parse as plain IPv4/IPv6, since this gates an outbound fetch.
 */
function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 0) return true; // 0.0.0.0/8
    // 100.64.0.0/10 (carrier-grade NAT) - also where at least one major
    // cloud provider (Alibaba Cloud, 100.100.100.200) serves its instance
    // metadata, the exact target class this check exists to block.
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1") return true; // loopback
    if (normalized.startsWith("fe80:")) return true; // link-local
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local
    // IPv4-mapped IPv6 embeds a real IPv4 address that must be checked
    // the same way - but it can show up in two different textual forms:
    // dotted ("::ffff:1.2.3.4", what dns.lookup tends to return) or the
    // compressed hex form ("::ffff:0102:0304", what `new URL()` always
    // normalizes a literal like http://[::ffff:169.254.169.254]/ to -
    // without handling the hex form too, that exact normalization would
    // silently defeat this check for a bracketed IPv6 literal.
    const dottedMapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dottedMapped) return isPrivateOrReservedIp(dottedMapped[1]);
    const hexMapped = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateOrReservedIp(dotted);
    }
    // NAT64's well-known prefix (64:ff9b::/96) also embeds an arbitrary
    // IPv4 address in its last 32 bits, same risk as the ::ffff: mapped
    // form above on any network running NAT64/DNS64.
    const nat64Dotted = normalized.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
    if (nat64Dotted) return isPrivateOrReservedIp(nat64Dotted[1]);
    const nat64Hex = normalized.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (nat64Hex) {
      const hi = parseInt(nat64Hex[1], 16);
      const lo = parseInt(nat64Hex[2], 16);
      const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateOrReservedIp(dotted);
    }
    return false;
  }
  return true; // unparseable - fail closed
}

const FETCH_TIMEOUT_MS = 10_000;
// Cap how much we read - this is untrusted third-party content and
// extractDocketNumberFromText only ever needs a small prefix of the page.
const MAX_RESPONSE_BYTES = 500_000;

/**
 * A `dns.lookup`-shaped resolver that rejects any hostname resolving to a
 * loopback/link-local/RFC1918 address (this covers the common cloud
 * metadata address, 169.254.169.254) before returning it. Passed as the
 * `lookup` option to http(s).request below so the SAME resolution that's
 * validated is the one actually used to open the TCP connection - using a
 * separate check-then-connect pair of lookups (e.g. one `dns.lookup` call
 * to validate, a second independent one inside `fetch()` to connect) would
 * leave a DNS-rebinding gap: an attacker-controlled hostname with a
 * near-zero TTL could resolve to a public address for the check and to an
 * internal one by the time the connection itself is made.
 */
function validatingLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
): void {
  // Force single-address resolution regardless of what http(s)'s
  // internals asked for in `options.all` - this callback shape only
  // accepts one address, and a single address is also exactly what
  // http(s) actually uses to open its one TCP connection.
  dns.lookup(hostname, { family: options.family }, (err, address, family) => {
    if (err) {
      callback(err, address, family);
      return;
    }
    if (isPrivateOrReservedIp(address)) {
      callback(
        new Error(`Refusing to connect to private/reserved address ${address}`) as NodeJS.ErrnoException,
        address,
        family,
      );
      return;
    }
    callback(null, address, family);
  });
}

/**
 * Fetches `urlString` with the resolved address pinned via
 * validatingLookup above, so the whole request fails closed rather than
 * ever reaching a private/internal target. This fetch's target comes from
 * a third-party lead source's own scraped content (TCA's or
 * classaction.org's listing fields), not a value this app controls, so
 * without this a single malicious or compromised listing could point the
 * worker's own outbound fetch at cloud metadata endpoints or other
 * internal-only services.
 */
function fetchExternalText(urlString: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return Promise.resolve(null);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return Promise.resolve(null);
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost") return Promise.resolve(null);
  // When the URL's host is already a literal IP address, Node's
  // connection logic skips DNS resolution entirely - the `lookup` option
  // below is simply never invoked - so validatingLookup alone would let a
  // literal-IP SSRF payload (e.g. http://169.254.169.254/...) straight
  // through. Must be checked explicitly, before ever issuing the request.
  // `URL` keeps a literal IPv6 host bracketed (e.g. "[::1]"), which
  // net.isIP doesn't recognize as an address at all - strip the brackets
  // first or this check silently no-ops for every IPv6 literal.
  const bracketedIpv6 = hostname.match(/^\[(.+)\]$/);
  const literalIpCandidate = bracketedIpv6 ? bracketedIpv6[1] : hostname;
  if (net.isIP(literalIpCandidate) && isPrivateOrReservedIp(literalIpCandidate)) {
    return Promise.resolve(null);
  }

  const client = url.protocol === "https:" ? https : http;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const req = client.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        },
        lookup: validatingLookup,
        timeout: FETCH_TIMEOUT_MS,
      },
      (res) => {
        // Any redirect is treated as a failure, never followed - a
        // redirect target hasn't itself been through validatingLookup.
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          finish(null);
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          chunks.push(chunk);
          if (bytes > MAX_RESPONSE_BYTES) req.destroy();
        });
        res.on("end", () => finish(Buffer.concat(chunks).toString("utf8")));
        res.on("close", () => finish(Buffer.concat(chunks).toString("utf8")));
        res.on("error", () => finish(null));
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => finish(null));
  });
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
    const body = await fetchExternalText(url);
    if (body === null) return null;
    return extractDocketNumberFromText(body);
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
 * Actions, classaction.org) as LEAD sources. Every lead is still
 * independently cross-referenced against CourtListener's own docket index
 * (public even when documents are paywalled) before being labeled
 * anything but "unverified" — we never treat a lead source's own
 * description as confirmed fact.
 *
 * Unlike this worker's other discovery paths, a failed or inconclusive
 * docket match no longer drops the lead: the settlement is still
 * published, honestly labeled "unverified" (clearly disclosed on its page,
 * see SettlementCard.tsx), since the tracker listing it is itself real
 * signal even without court-record confirmation — at the project owner's
 * explicit direction, given CourtListener's shared rate limit and these
 * trackers' own marketing-style naming mean a lot of genuine settlements
 * would otherwise never match. A docket match still earns "verified" or
 * "probable" (domain-allowlist-dependent) exactly as before, and a later
 * run that DOES find one upgrades an already-published unverified
 * settlement in place rather than publishing a duplicate.
 */
export async function runAggregatorDiscovery(
  pool: Pool,
  stats: RunStats,
): Promise<string[]> {
  // Collected (not just console.error'd) so a run where every lead fails -
  // e.g. the shared CourtListener budget being exhausted - shows up in the
  // stored worker_runs record that monitoring actually looks at, not just
  // in ephemeral process logs. See index.ts, which folds these into the
  // same `errors` list the other discovery paths report through.
  const leadErrors: string[] = [];

  // allSettled, not all: politeFetch in both aggregator.ts and
  // classActionOrgSource.ts lets a raw network failure (DNS, connection
  // reset, TLS) throw rather than returning null, same as any other
  // fetch(). Promise.all would let either source's rejection discard the
  // OTHER source's already-fetched leads for the whole run - exactly the
  // "one source failing takes the other down with it" bug this function's
  // own design comment says must not happen.
  const [tcaResult, classActionOrgResult] = await Promise.allSettled([
    fetchOpenSettlementLeadUrls(TCA_LEADS_PER_RUN),
    fetchClassActionOrgLeads(CLASS_ACTION_ORG_LEADS_PER_RUN),
  ]);
  const tcaUrls = tcaResult.status === "fulfilled" ? tcaResult.value : [];
  if (tcaResult.status === "rejected") {
    leadErrors.push(
      `tca listing fetch: ${
        tcaResult.reason instanceof Error ? tcaResult.reason.message : String(tcaResult.reason)
      }`,
    );
  }
  const classActionOrgLeads = classActionOrgResult.status === "fulfilled" ? classActionOrgResult.value : [];
  if (classActionOrgResult.status === "rejected") {
    leadErrors.push(
      `classActionOrg listing fetch: ${
        classActionOrgResult.reason instanceof Error
          ? classActionOrgResult.reason.message
          : String(classActionOrgResult.reason)
      }`,
    );
  }
  const pendingLeads: PendingLead[] = [
    ...tcaUrls.map((url): PendingLead => ({ source: "tca", identifier: url })),
    ...classActionOrgLeads.map(
      (lead): PendingLead => ({ source: "classActionOrg", identifier: lead.sourceUrl, lead }),
    ),
  ];

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

      let docket: RecapDocket | null;
      try {
        docket = await findDocketByCaseIdentifier({
          docketNumber: leadDocketNumber ?? extractedDocketNumber,
          caseName: lead.caseName,
        });
      } catch (err) {
        // findDocketByCaseIdentifier deliberately rethrows a real failure
        // (e.g. a CourtListener rate-limit hit, common given the shared
        // budget - see courtlistener.ts) rather than masking it as "no
        // match". That distinction matters to *this* call, but letting it
        // propagate out of the per-lead try/catch below would drop the
        // whole lead for the run - exactly the "unverified publication"
        // this project's aggregator path exists to avoid losing. Record
        // the failure for visibility and fall through to the same
        // unverified branch a genuine no-match takes.
        leadErrors.push(
          `${pending.source}:${pending.identifier} docket lookup: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        docket = null;
      }
      if (
        docket &&
        extractedDocketNumber &&
        !caseNamesLikelyMatch(docket.caseName, lead.caseName ?? "")
      ) {
        // Not trustworthy enough on its own - see the comment above. Falls
        // through to the unverified branch below rather than being
        // dropped outright: the site still listed a real settlement, we
        // just couldn't independently confirm which court case it is.
        docket = null;
      }
      if (docket) stats.docketsScanned += 1;
      stats.candidatesFound += 1;

      const isKnown = isKnownAdministratorDomain(domain);
      let verificationStatus: "verified" | "probable" | "unverified";
      let confidenceScore: number;
      let verificationSource: string;
      if (docket) {
        verificationStatus = isKnown ? "verified" : "probable";
        confidenceScore = isKnown ? 80 : 50;
        verificationSource = isKnown
          ? "known settlement administrator domain (found via public settlement tracker)"
          : "found via public settlement tracker, matched to a real CourtListener docket — domain not independently recognized, verify before filing";
      } else {
        // Published anyway, at the user's request: a settlement tracker
        // listing it is itself real signal, even without an independent
        // court-record match (CourtListener's shared rate limit and these
        // trackers' own marketing-style naming mean a lot of genuine
        // settlements won't match on a given run, or ever). A later run
        // can still upgrade this exact row to verified/probable once a
        // docket is found - see findSettlementByUrl below, which finds
        // this same row again by its URL regardless of docket match.
        verificationStatus = "unverified";
        confidenceScore = isKnown ? 30 : 15;
        verificationSource =
          "listed by a public settlement tracker — not yet matched to a court record, verify independently before filing";
      }

      const claimDeadline = parseUsDate(lead.exclusionDeadline);
      const finalApprovalHearingDate = parseUsDate(lead.finalHearingDate);
      const { status, stage } = deriveStatusAndStage({
        hasWebsite: true,
        claimDeadline,
        finalApprovalDate: finalApprovalHearingDate,
      });

      // Deduped by the lead's own stable source identifier (pending.
      // identifier - the tracker's own listing URL), not domain/
      // administrator or the resolved official site URL: a shared
      // settlement-administrator domain can host hundreds of unrelated
      // settlements, and the official URL a source exposes for the same
      // lead could in principle vary between scrapes. This path never
      // uses the docket-scoped findMatchingSettlement other discovery
      // paths use (there may be no docket at all yet). The same row is
      // found whether this is a re-seen lead that's still unverified or
      // one that's finally resolved to a real docket this run -
      // upsertSettlement below then naturally upgrades it in place
      // either way.
      const existing = await findSettlementBySourceIdentifier(pool, pending.identifier);

      const settlementId = await upsertSettlement(pool, existing, {
        courtlistenerDocketId: docket?.docket_id ?? null,
        caseName: lead.caseName ?? docket?.caseName ?? null,
        // Prefer the matched docket's own (verified) number over whatever
        // we searched with - important for extractedDocketNumber, which
        // could in principle differ from the real docket's number if the
        // match actually came through the case-name fallback rather than
        // the number itself.
        docketNumber: docket?.docketNumber ?? leadDocketNumber ?? extractedDocketNumber,
        courtId: docket?.court_id ?? null,
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
