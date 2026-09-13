import { isBoilerplateDomain, isKnownAdministratorDomain } from "./keywords.js";

const URL_PATTERN = /\bhttps?:\/\/[^\s)"'<>]+/gi;

export interface ExtractedUrl {
  url: string;
  domain: string;
}

function normalizeUrl(raw: string): string {
  // Trim trailing punctuation that regularly gets swept up from prose
  // ("...at http://example.com. The").
  return raw.replace(/[.,;:!?)\]]+$/, "");
}

/** Pulls http(s) URLs out of free text, dropping known court/PACER boilerplate. */
export function extractCandidateUrls(text: string): ExtractedUrl[] {
  const matches = text.match(URL_PATTERN) ?? [];
  const seen = new Set<string>();
  const results: ExtractedUrl[] = [];

  for (const raw of matches) {
    const url = normalizeUrl(raw);
    let domain: string;
    try {
      domain = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (isBoilerplateDomain(domain)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({ url, domain });
  }

  return results;
}

export type VerificationStatus = "verified" | "probable" | "unverified";

export interface ConfidenceResult {
  verificationStatus: VerificationStatus;
  confidenceScore: number;
  verificationSource: string;
}

/**
 * Scores an extracted URL's likelihood of being the real settlement /
 * claims site. Never returns "verified" purely because a URL exists —
 * that requires a positive signal (known administrator domain, or found
 * in an actual court order).
 */
export function scoreUrl(params: {
  domain: string;
  foundInCourtOrder: boolean;
  matchedKeyword: string | null;
}): ConfidenceResult {
  const { domain, foundInCourtOrder, matchedKeyword } = params;
  const isKnownAdministrator = isKnownAdministratorDomain(domain);

  if (isKnownAdministrator && foundInCourtOrder) {
    return {
      verificationStatus: "verified",
      confidenceScore: 95,
      verificationSource: "known settlement administrator domain, cited in a court order",
    };
  }
  if (isKnownAdministrator) {
    return {
      verificationStatus: "verified",
      confidenceScore: 80,
      verificationSource: "known settlement administrator domain",
    };
  }
  if (foundInCourtOrder) {
    return {
      verificationStatus: "probable",
      confidenceScore: 55,
      verificationSource: "cited in a court order, domain not independently recognized",
    };
  }
  if (matchedKeyword) {
    return {
      verificationStatus: "probable",
      confidenceScore: 35,
      verificationSource: `found alongside ${matchedKeyword} in a docket filing`,
    };
  }
  return {
    verificationStatus: "unverified",
    confidenceScore: 15,
    verificationSource: "url found in docket text, no corroborating signal",
  };
}
