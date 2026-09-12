"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function CaseError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="page">
      <Link href="/" className="back-link">
        ← Back to search
      </Link>
      <p className="error">
        Something went wrong loading this case. This is usually a temporary
        issue with the CourtListener API.
      </p>
      <button type="button" className="retry-button" onClick={() => retry()}>
        Try again
      </button>
    </main>
  );
}
