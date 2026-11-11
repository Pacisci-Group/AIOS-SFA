import { ExternalLink, FileText, Loader2, PhoneCall } from "lucide-react";
import { useState } from "react";
import { SectionLabel } from "@/components/common/DetailCard";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/features/lead/components/lead-display";
import { getAuditAttachmentUrl } from "@/lib/deal-audits-api";

/** A document on an audit item, as either the board or the review page sends it. */
export interface EvidenceFile {
  /** Position in the item's `attachments` — what the download route takes. */
  index: number;
  filename: string;
  size: number;
  /** Absent on the producer's board rows. */
  uploadedAt?: string | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The documents behind one audit item (PAC-65 #16) — shared by the producer's
 * hand-off drawer and the manager's Deal Audit page (PAC-106).
 *
 * Two presentations of one requirement, and which one shows is the whole point
 * of the rule that the audit fires whether or not a document was uploaded:
 *
 *  - **A document is attached** — surface it so it is verified in place.
 *    Producers have uploaded these since PAC-56 #21b and nothing ever read
 *    them, so the service team was chasing files already sitting in storage.
 *  - **Nothing attached** — say so, and say what to do instead (`empty`). An
 *    absent evidence block would read as "no evidence needed". Pass
 *    `empty={null}` where no document is expected at all (a manager-only item).
 *
 * The URL is fetched on click because presigned links expire; a panel left open
 * would otherwise hand out dead ones.
 *
 * ⚠ Load-bearing. It moved from the drawer's root into each requirement when
 * the drawer became deal-scoped (PAC-72), and out of `ResolvePanel` when the
 * manager's page needed the same thing (PAC-106); it must not be lost in a
 * rework.
 */
export function EvidenceBlock({
  itemId,
  attachments,
  empty,
}: {
  itemId: string;
  attachments: EvidenceFile[];
  empty: { title: string; hint: string } | null;
}) {
  const [opening, setOpening] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (file: EvidenceFile) => {
    setOpening(file.index);
    setError(null);
    try {
      const { downloadUrl } = await getAuditAttachmentUrl(itemId, file.index);
      window.open(downloadUrl, "_blank", "noopener");
    } catch {
      setError("Could not open that document. Try again.");
    } finally {
      setOpening(null);
    }
  };

  if (attachments.length === 0) {
    if (!empty) return null;
    return (
      <div className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/8 p-3">
        <PhoneCall
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-500"
        />
        <div>
          <p className="text-sm font-medium text-foreground">{empty.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{empty.hint}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionLabel className="mb-2">Evidence on file</SectionLabel>
      <div className="flex flex-col gap-2">
        {attachments.map((file) => (
          <Button
            key={file.index}
            type="button"
            variant="outline"
            onClick={() => void open(file)}
            disabled={opening === file.index}
            className="h-auto justify-start gap-3 rounded-lg px-3 py-2.5 text-left"
          >
            {opening === file.index ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : (
              <FileText className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">
                {file.filename}
              </span>
              <span className="block text-xs text-muted-foreground">
                {formatSize(file.size)} ·{" "}
                {file.uploadedAt
                  ? `uploaded ${formatDate(file.uploadedAt)}`
                  : "uploaded at sale"}
              </span>
            </span>
            <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
