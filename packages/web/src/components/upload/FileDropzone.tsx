import { FileText, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface FileDropzoneProps {
  /** Accepted MIME types, e.g. `['application/pdf', 'image/png']`. */
  accept: readonly string[];
  /**
   * Extensions accepted **in addition to** {@link accept}, e.g. `['.csv']`.
   *
   * Needed wherever the browser cannot be trusted to report a type: `File.type`
   * for a `.csv` is `text/csv` on Chrome, `application/vnd.ms-excel` on Windows
   * where Excel owns the extension, and frequently the empty string on Safari
   * or for a file that came out of a cloud drive. Matching on type alone
   * rejects real files for a reason the user cannot see or act on.
   *
   * Omit it wherever the type is reliable (PDFs and images are).
   */
  acceptExtensions?: readonly string[];
  maxBytes: number;
  file: File | null;
  onSelect: (file: File | null) => void;
  /** Human copy for the size/type hint, e.g. "PDF, JPG, PNG up to 10MB". */
  hint: string;
  /** Hides the remove affordance and blocks selection while a submit is in flight. */
  disabled?: boolean;
  "aria-label"?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Drag-and-drop file picker with client-side type/size checks.
 *
 * Lifted from `ResolvePanel` (PAC-14) and re-expressed in design tokens — that
 * copy hard-codes `border-white/10`, `bg-white/[0.02]` and `text-sky-400`,
 * which would fail the light-theme requirement here. `ResolvePanel` is left on
 * its own copy for now: `packages/web` has no tests, so restyling a shipped
 * page as a side effect of this ticket is unbacked risk. Migrating it is its
 * own change.
 *
 * The type/size checks here are a fast local rejection, not the enforcement
 * point — the API re-reads both from storage via `HeadObject`, because a
 * declared size proves nothing about what was actually uploaded.
 */
export function FileDropzone({
  accept,
  acceptExtensions,
  maxBytes,
  file,
  onSelect,
  hint,
  disabled = false,
  "aria-label": ariaLabel = "Upload a file",
}: FileDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const select = (candidate: File | undefined | null) => {
    if (!candidate || disabled) return;
    const nameMatches = acceptExtensions?.some((ext) =>
      candidate.name.toLowerCase().endsWith(ext.toLowerCase()),
    );
    // Either signal is enough. See `acceptExtensions`.
    if (!accept.includes(candidate.type) && !nameMatches) {
      setError("Unsupported file type.");
      return;
    }
    if (candidate.size > maxBytes) {
      setError(`File is too large (max ${formatSize(maxBytes)}).`);
      return;
    }
    setError(null);
    onSelect(candidate);
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={[...accept, ...(acceptExtensions ?? [])].join(",")}
        className="hidden"
        onChange={(e) => select(e.target.files?.[0])}
      />

      {file ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background/40 p-4">
          <FileText size={20} className="shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-foreground">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatSize(file.size)}
            </p>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={() => {
                onSelect(null);
                // Clear the input too, so re-picking the same file re-fires
                // `onChange` (a browser suppresses it when `value` is unchanged).
                if (inputRef.current) inputRef.current.value = "";
              }}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Remove file"
            >
              <X size={16} />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            select(e.dataTransfer.files?.[0]);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "w-full rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-all border-2 border-dashed",
            "disabled:cursor-not-allowed disabled:opacity-60",
            dragging
              ? "border-primary bg-primary/5"
              : "border-border bg-background/40",
          )}
        >
          <Upload size={32} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drop file here or{" "}
            <span className="text-primary font-medium">browse to upload</span>
          </p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </button>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
