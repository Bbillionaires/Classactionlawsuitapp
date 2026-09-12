import { NextRequest, NextResponse } from "next/server";
import { createSession, verifyPassword } from "@/lib/members/auth";
import { findMemberByEmail } from "@/lib/members/repository";

export async function POST(request: NextRequest) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  try {
    const member = email ? await findMemberByEmail(email) : null;
    const valid = member ? await verifyPassword(password, member.password_hash) : false;

    if (!member || !valid) {
      return NextResponse.json(
        { error: "Incorrect email or password." },
        { status: 401 },
      );
    }

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
