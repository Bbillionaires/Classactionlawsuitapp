import Link from "next/link";
import { Suspense } from "react";
import AuthForm from "../components/AuthForm";

export default function LoginPage() {
  return (
    <main className="page">
      <Link href="/" className="back-link">
        ← Back
      </Link>
      <h1>Log in</h1>
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
      <p className="auth-switch">
        Don&apos;t have an account? <Link href="/signup">Create one</Link>
      </p>
    </main>
  );
}
