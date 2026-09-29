import { FileText, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface FileDropzoneBaseProps {
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
  /** Human copy for the size/type hint, e.g. "PDF, JPG, PNG up to 10MB". */
  hint: string;
  /** Hides the remove affordance and blocks selection while a submit is in flight. */
  disabled?: boolean;
  "aria-label"?: string;
}

/** One file at a time — the default, and what every caller but one wants. */
interface SingleFileDropzoneProps extends FileDropzoneBaseProps {
  multiple?: false;
  file: File | null;
  onSelect: (file: File | null) => void;
}

/**
 * Several files, kept as a list (PAC-142).
 *
 * The drop area stays visible under the list so more can be added, and each
 * row has its own remove. Files that fail the type or size check are named in
 * the error and left out; the ones that pass are still added, so one bad file
 * in a drop of five does not throw the other four away.
 */
interface MultiFileDropzoneProps extends FileDropzoneBaseProps {
  multiple: true;
  files: File[];
  onSelectFiles: (files: File[]) => void;
}

type FileDropzoneProps = SingleFileDropzoneProps | MultiFileDropzoneProps;

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
 *
 * One component for one file or several rather than a fork: the checks, the
 * drop area and the file row are the same thing in both modes, and two copies
 * of the MIME-versus-extension rule above is how they drift.
 */
export function FileDropzone(props: FileDropzoneProps) {
  const {
    accept,
    acceptExtensions,
    maxBytes,
    hint,
    disabled = false,
    "aria-label": ariaLabel = props.multiple ? "Upload files" : "Upload a file",
  } = props;
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Why a candidate is refused, or `null` when it passes. */
  const reject = (candidate: File): string | null => {
    const nameMatches = acceptExtensions?.some((ext) =>
      candidate.name.toLowerCase().endsWith(ext.toLowerCase()),
    );
    // Either signal is enough. See `acceptExtensions`.
    if (!accept.includes(candidate.type) && !nameMatches) {
      return "Unsupported file type.";
    }
    if (candidate.size > maxBytes) {
      return `File is too large (max ${formatSize(maxBytes)}).`;
    }
    return null;
  };

  // Clear the input too, so re-picking the same file re-fires `onChange` (a
  // browser suppresses it when `value` is unchanged).
  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = "";
  };

  const select = (list: FileList | null | undefined) => {
    if (disabled || !list || list.length === 0) return;
    const candidates = Array.from(list);

    if (!props.multiple) {
      const candidate = candidates[0];
      const reason = reject(candidate);
      if (reason) {
        setError(reason);
        return;
      }
      setError(null);
      props.onSelect(candidate);
      return;
    }

    const accepted: File[] = [];
    const refused: string[] = [];
    const already = new Set(props.files.map((f) => `${f.name}:${f.size}`));
    for (const candidate of candidates) {
      const reason = reject(candidate);
      if (reason) {
        refused.push(`${candidate.name} — ${reason.replace(/\.$/, "")}`);
      } else if (!already.has(`${candidate.name}:${candidate.size}`)) {
        accepted.push(candidate);
        already.add(`${candidate.name}:${candidate.size}`);
      }
    }
    setError(refused.length > 0 ? refused.join("; ") : null);
    if (accepted.length > 0) props.onSelectFiles([...props.files, ...accepted]);
    resetInput();
  };

  const row = (file: File, onRemove: () => void) => (
    <div
      key={`${file.name}:${file.size}`}
      className="flex items-center gap-3 rounded-xl border border-border bg-background/40 p-4"
    >
      <FileText size={20} className="shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{file.name}</p>
        <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
      </div>
      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`Remove ${file.name}`}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );

  const dropArea = (
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
        select(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "w-full rounded-xl flex flex-col items-center gap-3 cursor-pointer transition-all border-2 border-dashed",
        props.multiple && props.files.length > 0 ? "p-4" : "p-8",
        "disabled:cursor-not-allowed disabled:opacity-60",
        dragging
          ? "border-primary bg-primary/5"
          : "border-border bg-background/40",
      )}
    >
      <Upload
        size={props.multiple && props.files.length > 0 ? 20 : 32}
        className="text-muted-foreground"
      />
      <p className="text-sm text-muted-foreground">
        {props.multiple && props.files.length > 0
          ? "Drop more files here or "
          : props.multiple
            ? "Drop files here or "
            : "Drop file here or "}
        <span className="text-primary font-medium">browse to upload</span>
      </p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </button>
  );

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple={props.multiple === true}
        accept={[...accept, ...(acceptExtensions ?? [])].join(",")}
        className="hidden"
        onChange={(e) => select(e.target.files)}
      />

      {props.multiple ? (
        <div className="flex flex-col gap-2">
          {props.files.map((file) =>
            row(file, () => {
              props.onSelectFiles(props.files.filter((f) => f !== file));
              resetInput();
            }),
          )}
          {dropArea}
        </div>
      ) : props.file ? (
        row(props.file, () => {
          props.onSelect(null);
          resetInput();
        })
      ) : (
        dropArea
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
