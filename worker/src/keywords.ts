/** Settlement-related terms to match against docket entry descriptions. */
export const SETTLEMENT_KEYWORDS: string[] = [
  "settlement",
  "settlement agreement",
  "proposed settlement",
  "preliminary approval",
  "motion for preliminary approval",
  "order granting preliminary approval",
  "final approval",
  "settlement notice",
  "notice of settlement",
  "class notice",
  "claim form",
  "claims administrator",
  "settlement administrator",
  "settlement website",
  "file a claim",
  "claim deadline",
];

export function matchesSettlementKeyword(text: string): string | null {
  const lower = text.toLowerCase();
  for (const keyword of SETTLEMENT_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

/**
 * Domains known to belong to court-appointed settlement/claims
 * administrators. Not exhaustive — this is a confidence signal, not a
 * gatekeeper: an unrecognized domain is simply "unverified", never
 * discarded.
 *
 * Every entry here was confirmed via web search against the
 * administrator's own site before being added (2026-09-12) — do not add
 * a domain from memory alone. A wrong entry here would make an
 * unverified/wrong URL look "verified" to a real claimant, which is
 * exactly what this list exists to prevent.
 */
export const KNOWN_ADMINISTRATOR_DOMAINS: string[] = [
  "kccllc.com", // KCC Class Action Services
  "kroll.com", // Kroll Settlement Administration
  "epiqglobal.com", // Epiq
  "jndla.com", // JND Legal Administration
  "angeiongroup.com", // Angeion Group
  "simpluris.com", // Simpluris
  "rustconsulting.com", // Rust Consulting
  "cptgroup.com", // CPT Group
  "gardencitygroup.com", // Garden City Group (GCG)
  "atticusadmin.com", // Atticus Administration
];

/**
 * Domains that are the court's own infrastructure, not a settlement site.
 * Entry descriptions constantly link to these (e.g. PACER's own
 * "commonly-used-forms" boilerplate) — never treat them as a candidate
 * settlement URL.
 */
const BOILERPLATE_DOMAIN_PATTERNS: RegExp[] = [
  /(^|\.)uscourts\.gov$/i,
  /^pacer\.gov$/i,
  /(^|\.)pacer\.uscourts\.gov$/i,
  /^ecf\./i,
  /(^|\.)courtlistener\.com$/i,
  /(^|\.)recapthelaw\.org$/i,
];

export function isBoilerplateDomain(domain: string): boolean {
  return BOILERPLATE_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain));
}

export function isKnownAdministratorDomain(domain: string): boolean {
  return KNOWN_ADMINISTRATOR_DOMAINS.some(
    (known) => domain === known || domain.endsWith(`.${known}`),
  );
}

const ADMINISTRATOR_NAMES_BY_DOMAIN: Record<string, string> = {
  "kccllc.com": "KCC Class Action Services",
  "kroll.com": "Kroll Settlement Administration",
  "epiqglobal.com": "Epiq",
  "jndla.com": "JND Legal Administration",
  "angeiongroup.com": "Angeion Group",
  "simpluris.com": "Simpluris",
  "rustconsulting.com": "Rust Consulting",
  "cptgroup.com": "CPT Group",
  "gardencitygroup.com": "Garden City Group (GCG)",
  "atticusadmin.com": "Atticus Administration",
};

/** Human-readable administrator name for a known domain, or null. */
export function administratorNameForDomain(domain: string): string | null {
  const known = KNOWN_ADMINISTRATOR_DOMAINS.find(
    (candidate) => domain === candidate || domain.endsWith(`.${candidate}`),
  );
  return known ? ADMINISTRATOR_NAMES_BY_DOMAIN[known] : null;
}
