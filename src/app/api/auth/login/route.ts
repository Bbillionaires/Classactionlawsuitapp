import { NextRequest, NextResponse } from "next/server";
import { createSession, verifyPassword } from "@/lib/members/auth";
import {
  clearFailedLogins,
  findMemberByEmail,
  getLoginLockoutRemainingMs,
  recordFailedLogin,
} from "@/lib/members/repository";

export async function POST(request: NextRequest) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email) {
    return NextResponse.json(
      { error: "Incorrect email or password." },
      { status: 401 },
    );
  }

  try {
    // Checked (and throttled) by email alone, before ever touching the
    // password - this is the one check that must never depend on whether
    // the email is real, or a 429-vs-401 split would leak which emails
    // have an account.
    const lockoutRemainingMs = await getLoginLockoutRemainingMs(email);
    if (lockoutRemainingMs > 0) {
      return NextResponse.json(
        {
          error: `Too many failed attempts. Try again in ${Math.ceil(
            lockoutRemainingMs / 60_000,
          )} minute(s).`,
        },
        { status: 429 },
      );
    }

    const member = await findMemberByEmail(email);
    const valid = member ? await verifyPassword(password, member.password_hash) : false;

    if (!member || !valid) {
      await recordFailedLogin(email);
      return NextResponse.json(
        { error: "Incorrect email or password." },
        { status: 401 },
      );
    }

    await clearFailedLogins(email);
    await createSession(member.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Login failed:", error);
    return NextResponse.json(
      { error: "Something went wrong signing you in." },
      { status: 500 },
    );
  }
}
