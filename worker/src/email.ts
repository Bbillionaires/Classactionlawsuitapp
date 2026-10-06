import { Resend } from "resend";

// Same env-gated, best-effort pattern as the main app's
// src/lib/members/email.ts (a separate npm package, so duplicated here
// rather than imported): never throws - a failed alert email shouldn't
// fail the worker run. Unlike that one, this reports back whether the
// send actually happened, so a caller that's about to mark something as
// "delivered" (saved_search_alerts_sent) can skip that when it wasn't.
let resend: Resend | null = null;

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resend) resend = new Resend(apiKey);
  return resend;
}

export async function sendAlertEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  const client = getClient();
  const from = process.env.RESEND_FROM_EMAIL;
  if (!client || !from) return false;

  try {
    // The Resend SDK does NOT throw on an API-level failure (bad
    // domain, invalid recipient, Resend's own rate limit, etc.) -
    // fetchRequest() catches that internally and resolves with
    // { data: null, error } instead (confirmed directly against
    // node_modules/resend/dist/index.cjs). A try/catch alone would
    // silently treat every one of those as a successful send.
    const { error } = await client.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    if (error) {
      console.error("Resend rejected saved-search alert email:", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Failed to send saved-search alert email:", error);
    return false;
  }
}
