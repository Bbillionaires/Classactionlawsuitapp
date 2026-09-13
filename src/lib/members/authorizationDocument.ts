/**
 * The one-link, sign-once authorization every member completes before we
 * will file any claim on their behalf.
 *
 * IMPORTANT: this text is a functional placeholder, not vetted legal
 * language. Before this flow is used for a real claim submission or fee
 * collection, have an attorney review it — in particular: (1) the scope
 * of authority granted, (2) the hold-harmless/release language, and (3)
 * whether "claims preparation/filing assistance for a fee" needs any
 * state-specific licensing or disclosure given your jurisdiction(s) of
 * operation. Bump DOCUMENT_VERSION whenever the text changes so existing
 * signatures stay tied to the version they actually agreed to.
 */
export const DOCUMENT_VERSION = "2026-09-12.v1";

export const AUTHORIZATION_TEXT = `
Authorization to File Claims and Release of Liability

By signing below, I authorize ClassActionPayouts.com ("the Company") to
prepare and submit class action settlement claims on my behalf, using
the identity documents and supporting proof I upload to my account, for
the settlements I specifically request help with.

1. Accuracy of information. I confirm that all information and
   documents I provide are true, accurate, and belong to me, and that I
   am eligible to make a claim in each settlement I request help with.

2. Preparation fee. I understand a preparation fee may apply to each
   claim the Company files on my behalf, disclosed to me before the
   claim is submitted, and that this fee is separate from and does not
   guarantee any settlement award.

3. No guarantee of outcome. I understand the Company does not control,
   and cannot guarantee, whether a settlement administrator approves my
   claim, the amount of any award, or when payment is made.

4. Release. To the fullest extent permitted by law, I release and hold
   harmless the Company, its officers, and its agents from any claim,
   loss, or damage arising from the preparation or submission of a claim
   under this authorization, except where caused by the Company's own
   willful misconduct or fraud.

5. Revocation. I may revoke this authorization at any time in writing
   for any claim not yet submitted to a settlement administrator.

I have read and agree to the above.
`.trim();
