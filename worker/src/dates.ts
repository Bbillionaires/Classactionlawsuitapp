const MONTH_NAMES =
  "(January|February|March|April|May|June|July|August|September|October|November|December)";

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const DATE_PATTERN = new RegExp(
  `${MONTH_NAMES}\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}/\\d{1,2}/\\d{4}`,
  "i",
);

function parseDateToken(token: string): Date | null {
  const slash = token.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, m, d, y] = slash;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const named = token.match(
    new RegExp(`^${MONTH_NAMES}\\s+(\\d{1,2}),?\\s+(\\d{4})$`, "i"),
  );
  if (named) {
    const [, month, day, year] = named;
    const monthIndex = MONTH_INDEX[month.toLowerCase()];
    const date = new Date(Number(year), monthIndex, Number(day));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

// Guards against misreading an unrelated number pair as a date: a real
// claim deadline or hearing date won't be more than a year in the past
// (we'd have caught it by now) or more than five years out.
function isPlausible(date: Date): boolean {
  const now = Date.now();
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;
  return date.getTime() > now - oneYearMs && date.getTime() < now + 5 * oneYearMs;
}

/**
 * Finds a date only when it sits close to one of the given anchor
 * phrases — never just "the first date in the document", which could be
 * a filing date, a case-opening date, or anything else unrelated.
 * Deliberately conservative: no anchor match nearby means no date, not a
 * guess at one.
 */
function extractAnchoredDate(text: string, anchors: RegExp[]): Date | null {
  for (const anchor of anchors) {
    const anchorMatch = anchor.exec(text);
    if (!anchorMatch) continue;
    const window = text.slice(anchorMatch.index, anchorMatch.index + 160);
    const dateMatch = DATE_PATTERN.exec(window);
    if (!dateMatch) continue;
    const date = parseDateToken(dateMatch[0]);
    if (date && isPlausible(date)) return date;
  }
  return null;
}

const CLAIM_DEADLINE_ANCHORS = [
  /claims?\s+(?:must|should)?\s*(?:be\s+)?(?:submitted|postmarked|filed|received)\s+(?:no later than|by|on or before)/i,
  /claim\s+(?:filing\s+)?deadline\s+(?:is|of)/i,
  /deadline\s+(?:to|for)\s+(?:submit(?:ting)?|file|filing)\s+(?:a\s+)?claims?\s+is/i,
];

const FINAL_APPROVAL_ANCHORS = [
  /final\s+approval\s+hearing\s+(?:is\s+)?(?:scheduled\s+for|set\s+for|will\s+be\s+held\s+on)/i,
  /fairness\s+hearing\s+(?:is\s+)?(?:scheduled\s+for|set\s+for|will\s+be\s+held\s+on)/i,
];

/** A claim-submission deadline, extracted only from unambiguous phrasing. */
export function extractClaimDeadline(text: string): Date | null {
  return extractAnchoredDate(text, CLAIM_DEADLINE_ANCHORS);
}

/** A final approval / fairness hearing date, extracted the same way. */
export function extractFinalApprovalDate(text: string): Date | null {
  return extractAnchoredDate(text, FINAL_APPROVAL_ANCHORS);
}
