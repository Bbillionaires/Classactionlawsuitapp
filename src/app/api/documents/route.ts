import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getCurrentMemberId } from "@/lib/members/auth";
import { addMemberDocument } from "@/lib/members/repository";
import type { MemberDocumentType } from "@/lib/members/types";

const DOC_TYPES: MemberDocumentType[] = ["government_id", "claim_proof"];
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB — plenty for an ID photo or PDF

export async function POST(request: NextRequest) {
  const memberId = await getCurrentMemberId();
  if (!memberId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Document uploads aren't configured yet." },
      { status: 503 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  const docType = form.get("docType");
  const claimRequestIdRaw = form.get("claimRequestId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file." }, { status: 400 });
  }
  if (typeof docType !== "string" || !DOC_TYPES.includes(docType as MemberDocumentType)) {
    return NextResponse.json({ error: "Invalid document type." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File is too large (10MB max)." }, { status: 413 });
  }

  const claimRequestId =
    typeof claimRequestIdRaw === "string" && claimRequestIdRaw.trim()
      ? Number(claimRequestIdRaw)
      : null;

  try {
    // Private access: these are government ID photos and claim proof
    // documents — never a publicly-guessable URL. Only server-side code
    // holding BLOB_READ_WRITE_TOKEN can read them back.
    const blob = await put(`members/${memberId}/${docType}-${Date.now()}-${file.name}`, file, {
      access: "private",
      contentType: file.type || undefined,
    });

    const document = await addMemberDocument({
      memberId,
      claimRequestId: Number.isFinite(claimRequestId) ? claimRequestId : null,
      docType: docType as MemberDocumentType,
      fileUrl: blob.url,
      fileName: file.name || null,
    });

    // Never echo the blob URL back to the client — it's a private
    // credential-bearing reference, not something the browser needs.
    return NextResponse.json({
      document: {
        id: document.id,
        doc_type: document.doc_type,
        file_name: document.file_name,
        uploaded_at: document.uploaded_at,
        claim_request_id: document.claim_request_id,
      },
    });
  } catch (error) {
    console.error("Document upload failed:", error);
    return NextResponse.json(
      { error: "Something went wrong uploading your document." },
      { status: 500 },
    );
  }
}
