import Link from "next/link";
import { Suspense } from "react";
import AuthForm from "../components/AuthForm";

export default function SignupPage() {
  return (
    <main className="page">
      <Link href="/" className="back-link">
        ← Back
      </Link>
      <h1>Create an account</h1>
      <p className="subtitle">
        Track settlements and get email updates. You can also request help
        filing a claim once you&apos;ve signed our filing authorization.
      </p>
      <Suspense>
        <AuthForm mode="signup" />
      </Suspense>
      <p className="auth-switch">
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}
