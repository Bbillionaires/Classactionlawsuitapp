import "server-only";
import { Resend } from "resend";

let resend: Resend | null = null;

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resend) resend = new Resend(apiKey);
  return resend;
}

/**
 * Best-effort email send: if Resend isn't configured yet (no API key /
 * no verified sending domain), this silently no-ops instead of breaking
 * signup or claim filing. Errors are logged, never thrown — email is a
 * nice-to-have notification, not a hard requirement for these flows.
 */
export async function sendMemberEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const client = getClient();
  const from = process.env.RESEND_FROM_EMAIL;
  if (!client || !from) return;

  try {
    await client.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
  } catch (error) {
    console.error("Failed to send member email:", error);
  }
}
