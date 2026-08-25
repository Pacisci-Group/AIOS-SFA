import { ExternalLink, FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { openDocumentInNewTab } from "@/lib/open-document";
import { getQuoteDocumentDownload } from "@/lib/quote-recaps-api";

interface QuoteDocumentLinkProps {
  recapId: string;
  filename: string;
  contentType: string;
  size: number;
}

/** `1.2 MB` / `812 KB` — enough for "is this the full quote or a screenshot?". */
function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** `application/pdf` → `PDF`, `image/jpeg` → `JPEG`. */
function formatKind(contentType: string): string {
  const subtype = contentType.split("/")[1] ?? contentType;
  return subtype.toUpperCase();
}

/**
 * The uploaded quote document (PAC-56 #10 + #30), as a control rather than a
 * line of text.
 *
 * It was an icon and a filename with no border and no button affordance — the
 * one genuinely *actionable* thing on the card looked like a caption, so nobody
 * clicked it. It is now a bordered row with the file's type and size, which is
 * also what tells a producer at a glance whether the attachment is the carrier
 * quote or someone's phone photo.
 *
 * The URL is fetched per click rather than rendered into an `href`, because it
 * is a short-lived presigned GET: baking one into the DOM on page load would
 * hand out a link that expires while the producer is still reading the page,
 * and would leak a live document URL into anything that scrapes the markup.
 */
export function QuoteDocumentLink({
  recapId,
  filename,
  contentType,
  size,
}: QuoteDocumentLinkProps) {
  const [opening, setOpening] = useState(false);

  const open = async () => {
    setOpening(true);
    try {
      await openDocumentInNewTab(async () => {
        const { downloadUrl } = await getQuoteDocumentDownload(recapId);
        return downloadUrl;
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn’t open the document",
      );
    } finally {
      setOpening(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={opening}
      className="group flex w-full items-center gap-3 rounded-lg border border-border bg-sunken px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
        {opening ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <FileText className="size-5" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-base text-card-foreground group-hover:text-primary">
          {filename}
        </span>
        <span className="block text-sm text-muted-foreground">
          {formatKind(contentType)} · {formatBytes(size)}
        </span>
      </span>

      {/* Not a nested `Button`: this whole row is the button. `asChild`-style
          styling on a span keeps the affordance without a second tab stop. */}
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground group-hover:text-primary"
      >
        <ExternalLink className="size-4" />
      </span>
      <span className="sr-only">Opens in a new tab</span>
    </button>
  );
}
