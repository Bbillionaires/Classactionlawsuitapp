import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentMemberId } from "@/lib/members/auth";
import { AUTHORIZATION_TEXT } from "@/lib/members/authorizationDocument";
import { getLatestAuthorization } from "@/lib/members/repository";
import AuthorizationForm from "../components/AuthorizationForm";

export default async function AuthorizePage() {
  const memberId = await getCurrentMemberId();
  if (!memberId) redirect("/login?next=/authorize");

  const existing = await getLatestAuthorization(memberId);

  return (
    <main className="page">
      <Link href="/account" className="back-link">
        ← Back to account
      </Link>
      <h1>Claim-filing authorization</h1>
      <p className="subtitle">
        Sign this once and it covers every claim you ask us to help file —
        no need to sign again for each one.
      </p>

      <pre className="authorization-text">{AUTHORIZATION_TEXT}</pre>

      {existing ? (
        <p className="authorization-signed">
          Signed by {existing.signed_name} on{" "}
          {new Date(existing.agreed_at).toLocaleDateString()}. You can
          re-sign below if you&apos;d like a fresh record.
        </p>
      ) : null}

      <Suspense>
        <AuthorizationForm />
      </Suspense>
    </main>
  );
}
