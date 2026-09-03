import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import {
  ALLOWED_BUG_SCREENSHOT_CONTENT_TYPES,
  MAX_BUG_SCREENSHOTS,
  MAX_BUG_SCREENSHOT_BYTES,
} from "@sfa/shared";
import type { PendingScreenshot } from "@/lib/bug-reports-api";
import { cn } from "@/lib/utils";

interface ScreenshotPickerProps {
  screenshots: PendingScreenshot[];
  onChange: (screenshots: PendingScreenshot[]) => void;
  disabled?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACCEPTED = new Set<string>(ALLOWED_BUG_SCREENSHOT_CONTENT_TYPES);

/**
 * Multi-image picker for bug screenshots: drop, browse, or **paste**.
 *
 * ## Why paste is the headline affordance, not a bonus
 *
 * The actual workflow is Cmd+Shift+4 (or PrtScn), which leaves the grab on the
 * clipboard and, on macOS, nowhere else at all unless the user remembers the
 * Ctrl modifier. Requiring a file means asking someone mid-bug to go find one.
 * The paste handler is bound to the **document** rather than a focused input so
 * it works the moment the dialog is open, wherever the caret happens to be —
 * which is almost always the description textarea.
 *
 * Clipboard images arrive as `image.png` with no meaningful name, so they are
 * renamed `screenshot-<n>.png` — five identically-named rows are unreadable in
 * the queue.
 *
 * ## Not `FileDropzone`
 *
 * That component is single-file by contract (`file: File | null`), has no paste
 * path, and renders a document row rather than an image thumbnail. Widening it
 * to a multi-file union would touch the Add Mailers and Resolve Panel call
 * sites for no benefit to either; this is the second shape, kept local to the
 * feature that needs it.
 */
export function ScreenshotPicker({
  screenshots,
  onChange,
  disabled = false,
}: ScreenshotPickerProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * `onChange` and `screenshots` come from the parent's render, so `add` is
   * rebuilt every render and the paste effect below would re-subscribe each
   * time. A ref holding the latest `add` keeps the listener registered exactly
   * once for the life of the dialog.
   */
  const add = useCallback(
    (candidates: File[]) => {
      if (disabled || candidates.length === 0) return;

      const room = MAX_BUG_SCREENSHOTS - screenshots.length;
      if (room <= 0) {
        setError(`Up to ${MAX_BUG_SCREENSHOTS} screenshots.`);
        return;
      }

      const accepted: PendingScreenshot[] = [];
      let rejection: string | null = null;

      for (const file of candidates.slice(0, room)) {
        if (!ACCEPTED.has(file.type)) {
          rejection = "Only PNG, JPG, WebP or GIF images.";
          continue;
        }
        if (file.size > MAX_BUG_SCREENSHOT_BYTES) {
          rejection = `Each image must be under ${formatSize(
            MAX_BUG_SCREENSHOT_BYTES,
          )}.`;
          continue;
        }
        accepted.push({
          id: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
        });
      }

      if (candidates.length > room && !rejection) {
        rejection = `Only the first ${room} added — up to ${MAX_BUG_SCREENSHOTS} screenshots.`;
      }
      setError(rejection);
      if (accepted.length) onChange([...screenshots, ...accepted]);
    },
    [disabled, onChange, screenshots],
  );

  const addRef = useRef(add);
  useEffect(() => {
    addRef.current = add;
  });

  /** Paste anywhere in the document while the dialog is mounted. */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (files.length === 0) return;
      // Only once we know there is an image: a plain text paste must still
      // reach the description textarea.
      event.preventDefault();
      addRef.current(
        files.map(
          (file, index) =>
            new File(
              [file],
              `screenshot-${Date.now()}-${index + 1}.${
                file.type.split("/")[1] ?? "png"
              }`,
              { type: file.type },
            ),
        ),
      );
    };

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const remove = (id: string) => {
    const target = screenshots.find((shot) => shot.id === id);
    // Object URLs are held by the document until revoked; dropping the React
    // reference alone leaks the whole image.
    if (target) URL.revokeObjectURL(target.previewUrl);
    setError(null);
    onChange(screenshots.filter((shot) => shot.id !== id));
  };

  const full = screenshots.length >= MAX_BUG_SCREENSHOTS;

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ALLOWED_BUG_SCREENSHOT_CONTENT_TYPES.join(",")}
        className="hidden"
        onChange={(event) => {
          add(Array.from(event.target.files ?? []));
          // Clear it so re-picking the same file re-fires `onChange`.
          if (inputRef.current) inputRef.current.value = "";
        }}
      />

      {screenshots.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {screenshots.map((shot) => (
            <li key={shot.id} className="group relative">
              <img
                src={shot.previewUrl}
                alt={shot.file.name}
                className="size-20 rounded-md border border-border object-cover"
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(shot.id)}
                  aria-label={`Remove ${shot.file.name}`}
                  className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-background p-0.5 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!full && (
        <button
          type="button"
          disabled={disabled}
          aria-label="Add screenshots"
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            add(Array.from(event.dataTransfer.files ?? []));
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed p-4 transition-all",
            "disabled:cursor-not-allowed disabled:opacity-60",
            dragging
              ? "border-primary bg-primary/5"
              : "border-border bg-background/40",
          )}
        >
          <ImagePlus className="size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Paste a screenshot, drop one here, or{" "}
            <span className="font-medium text-primary">browse</span>
          </p>
          <p className="text-xs text-muted-foreground">
            PNG, JPG, WebP or GIF up to {formatSize(MAX_BUG_SCREENSHOT_BYTES)} ·
            max {MAX_BUG_SCREENSHOTS}
          </p>
        </button>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
