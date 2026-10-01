import { NextRequest, NextResponse } from "next/server";
import { createSession, hashPassword } from "@/lib/members/auth";
import { sendMemberEmail } from "@/lib/members/email";
import { createMember, findMemberByEmail } from "@/lib/members/repository";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }

  try {
    const existing = await findMemberByEmail(email);
    if (existing) {
      return NextResponse.json(
        { error: "An account with that email already exists." },
        { status: 409 },
      );
    }

    const passwordHash = await hashPassword(password);
    const member = await createMember(email, passwordHash);
    await createSession(member.id);

    void sendMemberEmail({
      to: member.email,
      subject: "Welcome to ClassActionPayouts.com",
      text: "Your account is set up. We'll email you when there are updates on settlements you're tracking.",
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    // Postgres unique_violation (23505): two concurrent signups for the
    // same email both passed the findMemberByEmail check above before
    // either inserted. The DB constraint is the real source of truth —
    // report it the same way as the pre-check, not as a generic failure.
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "An account with that email already exists." },
        { status: 409 },
      );
    }
    console.error("Signup failed:", error);
    return NextResponse.json(
      { error: "Something went wrong creating your account." },
      { status: 500 },
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
