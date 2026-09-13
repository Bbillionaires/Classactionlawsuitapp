"use client";

import { useRouter } from "next/navigation";
import { ChangeEvent, useState } from "react";
import type { MemberDocumentType } from "@/lib/members/types";

const LABELS: Record<MemberDocumentType, string> = {
  government_id: "Government-issued ID",
  claim_proof: "Proof for your claim (receipt, statement, etc.)",
};

export default function DocumentUploadForm({
  docType,
}: {
  docType: MemberDocumentType;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);

    const form = new FormData();
    form.set("file", file);
    form.set("docType", docType);

    const res = await fetch("/api/documents", { method: "POST", body: form });
    const body = await res.json();

    if (!res.ok) {
      setError(body.error ?? "Upload failed.");
      setUploading(false);
      return;
    }

    router.refresh();
    setUploading(false);
    e.target.value = "";
  }

  return (
    <label className="document-upload">
      {LABELS[docType]}
      <input type="file" onChange={handleChange} disabled={uploading} />
      {uploading && <span className="document-upload-status">Uploading…</span>}
      {error && <p className="error">{error}</p>}
    </label>
  );
}
