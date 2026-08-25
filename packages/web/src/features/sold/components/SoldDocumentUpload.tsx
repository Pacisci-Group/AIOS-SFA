import type { SoldDocumentMeta } from "@sfa/shared";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { FileDropzone } from "@/components/upload/FileDropzone";
import {
  ALLOWED_SOLD_UPLOAD_TYPES,
  MAX_SOLD_UPLOAD_BYTES,
  uploadSoldDocument,
  type SoldUploadKind,
  type UploadScope,
} from "@/lib/sold-deals-api";

interface SoldDocumentUploadProps {
  uploadScope: UploadScope;
  value: SoldDocumentMeta | undefined;
  onChange: (meta: SoldDocumentMeta | undefined) => void;
  /** Accessible name, e.g. "Upload proof for Fire subscription". */
  ariaLabel: string;
  /** Validation message from the schema, shown once nothing is in flight. */
  error?: string;
  accept?: readonly string[];
  hint?: string;
  disabled?: boolean;
  /**
   * Which allow-list and key prefix the server should apply (PAC-56 #23).
   * Must agree with `accept` — the server rejects a mismatch either way.
   */
  kind?: SoldUploadKind;
}

/**
 * One uploaded document, wherever the sold wizard needs one.
 *
 * Extracted when PAC-56 #21 made proofs mandatory and #23 added the New
 * Business Application: the upload lifecycle (immediate PUT, in-flight state,
 * failure recovery) went from one place to four, and four copies would have
 * drifted on exactly the details that matter — clearing the attachment when an
 * upload fails, and not showing a stale error mid-flight.
 *
 * **Deliberately library-agnostic**: it takes `value`/`onChange`, not a form.
 * The binding lives at each call site, so this never has to know a field path.
 *
 * Uploads on select rather than at submit. The wizard can span several minutes,
 * and deferring every file to the end would make a slow or failed upload look
 * like a failed sale.
 */
export function SoldDocumentUpload({
  uploadScope,
  value,
  onChange,
  ariaLabel,
  error,
  accept = ALLOWED_SOLD_UPLOAD_TYPES,
  hint = "PDF, JPEG or PNG, up to 10MB",
  disabled,
  kind = "discount_proof",
}: SoldDocumentUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const onSelect = async (candidate: File | null) => {
    setFile(candidate);
    setUploadError(null);
    if (!candidate) {
      onChange(undefined);
      return;
    }

    setUploading(true);
    try {
      const meta = await uploadSoldDocument(uploadScope, candidate, kind);
      onChange(meta);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      // Both, and in this order: a half-succeeded upload that left the metadata
      // behind would submit a key whose bytes never landed.
      setFile(null);
      onChange(undefined);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <FileDropzone
        accept={accept}
        maxBytes={MAX_SOLD_UPLOAD_BYTES}
        file={file}
        onSelect={(candidate) => void onSelect(candidate)}
        disabled={disabled || uploading}
        aria-label={ariaLabel}
        hint={hint}
      />
      {uploading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Uploading…
        </p>
      )}
      {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
      {value && !uploading && (
        <p className="text-sm text-success">Attached — {value.filename}</p>
      )}
      {/* The schema's error, suppressed while an upload could still satisfy it. */}
      {error && !uploading && !value && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
