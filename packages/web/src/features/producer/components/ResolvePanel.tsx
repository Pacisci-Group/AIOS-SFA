import {
  Upload,
  Phone,
  ExternalLink,
  PhoneCall,
  MessageSquare,
  CheckCircle2,
  FileText,
  AlertTriangle,
  X,
  Loader2,
} from "lucide-react";
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  getAuditAttachmentUrl,
  resolveWithOptionalUpload,
  type DealAuditRow,
  type DealAuditRowAttachment,
} from "@/lib/deal-audits-api";

interface ResolvePanelProps {
  deal: DealAuditRow | null;
  onClose: () => void;
  onResolved: (id: string) => void;
}

const quickContact =
  "flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium border transition-all hover:brightness-110";

const ACCEPT = ALLOWED_UPLOAD_TYPES.join(",");

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "Due in 3 days" / "Due today" / "Overdue by 2 days" — display only. */
function formatDue(iso: string): string {
  const dueDate = new Date(iso);
  if (Number.isNaN(dueDate.getTime())) return "";
  const days = Math.round(
    (dueDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
  );
  if (days === 0) return "due today";
  if (days > 0) return `due in ${days} day${days === 1 ? "" : "s"}`;
  const over = Math.abs(days);
  return `overdue by ${over} day${over === 1 ? "" : "s"}`;
}

/**
 * What the auditor is actually working from (PAC-65 #16).
 *
 * Two presentations of one item, and which one shows is the whole point of the
 * ticket's rule that the audit fires whether or not a document was uploaded:
 *
 *  - **A document is attached** — surface it here so they verify it in place.
 *    Producers have uploaded these since PAC-56 #21b and nothing ever read
 *    them, so the service team was chasing files already sitting in storage.
 *  - **Nothing attached** — say so, and say what to do instead. An absent
 *    evidence block would read as "no evidence needed".
 *
 * The URL is fetched on click because presigned links expire; a panel left open
 * would otherwise hand out dead ones.
 */
function EvidenceBlock({ deal }: { deal: DealAuditRow }) {
  const [opening, setOpening] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (file: DealAuditRowAttachment) => {
    setOpening(file.index);
    setError(null);
    try {
      const { downloadUrl } = await getAuditAttachmentUrl(deal.id, file.index);
      window.open(downloadUrl, "_blank", "noopener");
    } catch {
      setError("Could not open that document. Try again.");
    } finally {
      setOpening(null);
    }
  };

  if (deal.attachments.length === 0) {
    return (
      <div className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/8 p-4">
        <PhoneCall size={16} className="mt-0.5 shrink-0 text-amber-500" />
        <div>
          <p className="text-sm font-medium text-foreground">
            No document on file
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Call the client and obtain it, then upload it below.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
        Evidence on file
      </p>
      <div className="flex flex-col gap-2">
        {deal.attachments.map((file) => (
          <Button
            key={file.index}
            type="button"
            variant="outline"
            onClick={() => void open(file)}
            disabled={opening === file.index}
            className="h-auto justify-start gap-3 rounded-lg px-3 py-2.5 text-left"
          >
            {opening === file.index ? (
              <Loader2 size={16} className="shrink-0 animate-spin" />
            ) : (
              <FileText size={16} className="shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">
                {file.filename}
              </span>
              <span className="block text-xs text-muted-foreground">
                {formatSize(file.size)} · uploaded at sale
              </span>
            </span>
            <ExternalLink size={14} className="shrink-0 text-muted-foreground" />
          </Button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function ResolvePanel({ deal, onClose, onResolved }: ResolvePanelProps) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /*
   * Text only, and deliberately. The deadline is a written target — nothing in
   * the product changes state when it passes, and this line must not imply
   * otherwise (PAC-65).
   */
  const dueLabel = deal?.dueAt ? formatDue(deal.dueAt) : null;

  const resolveMutation = useMutation({
    mutationFn: (id: string) =>
      resolveWithOptionalUpload(id, { note, file }),
    onSuccess: (_data, id) => {
      onResolved(id);
      close();
    },
  });

  const close = () => {
    setFile(null);
    setNote("");
    setFileError(null);
    setDragging(false);
    resolveMutation.reset();
    onClose();
  };

  const selectFile = (candidate: File | undefined | null) => {
    if (!candidate) return;
    if (!ALLOWED_UPLOAD_TYPES.includes(candidate.type as never)) {
      setFileError("Unsupported file type. Use PDF, JPG, or PNG.");
      return;
    }
    if (candidate.size > MAX_UPLOAD_BYTES) {
      setFileError("File is too large (max 10MB).");
      return;
    }
    setFileError(null);
    setFile(candidate);
  };

  const handleResolve = () => {
    if (!deal || resolveMutation.isPending) return;
    resolveMutation.mutate(deal.id);
  };

  const pending = resolveMutation.isPending;

  return (
    <Sheet open={!!deal} onOpenChange={(open) => !open && !pending && close()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-l border-border p-0 sm:w-[420px] sm:max-w-[420px] dark:border-white/[0.08] dark:bg-[#0D1628]"
      >
        {deal && (
          <>
            {/* Header */}
            <SheetHeader className="px-6 py-5 border-b border-border gap-1">
              <SheetDescription className="text-xs uppercase tracking-widest text-amber-500">
                Resolve Audit
              </SheetDescription>
              <SheetTitle className="text-foreground font-semibold">
                {deal.client}
              </SheetTitle>
            </SheetHeader>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">
              {/* Alert */}
              <div className="flex gap-3 p-4 rounded-xl bg-amber-500/8 border border-amber-500/20">
                <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-500" />
                <div>
                  <p className="text-sm text-foreground font-medium">
                    Missing: {deal.missing}
                  </p>
                  <p className="text-xs text-amber-500 mt-0.5">
                    Open for {deal.daysOpen} day{deal.daysOpen !== 1 ? "s" : ""}
                    {dueLabel ? ` · ${dueLabel}` : ""}
                  </p>
                </div>
              </div>

              <EvidenceBlock deal={deal} />

              {/* Upload zone */}
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                  Upload Document{" "}
                  <span className="text-slate-600 normal-case tracking-normal">
                    (optional)
                  </span>
                </p>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => selectFile(e.target.files?.[0])}
                />

                {file ? (
                  <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <FileText size={20} className="shrink-0 text-sky-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">
                        {file.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatSize(file.size)}
                      </p>
                    </div>
                    {!pending && (
                      <button
                        type="button"
                        onClick={() => setFile(null)}
                        className="shrink-0 text-slate-500 hover:text-slate-300"
                        aria-label="Remove file"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                ) : (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      selectFile(e.dataTransfer.files?.[0]);
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-all border-2 border-dashed",
                      dragging
                        ? "border-sky-400 bg-sky-400/5"
                        : "border-white/10 bg-white/[0.02]",
                    )}
                  >
                    <Upload size={32} className="text-muted-foreground" />
                    <div className="text-center">
                      <p className="text-sm text-slate-400">
                        Drop file here or{" "}
                        <span className="text-sky-400 font-medium">
                          browse to upload
                        </span>
                      </p>
                    </div>
                    <p className="text-xs text-slate-600">
                      PDF, JPG, PNG up to 10MB
                    </p>
                  </div>
                )}

                {fileError && (
                  <p className="mt-2 text-xs text-destructive">{fileError}</p>
                )}
              </div>

              {/* Quick contact (decorative — wired in a later story) */}
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                  Quick Contact
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled
                    className={cn(
                      quickContact,
                      "bg-emerald-500/12 text-emerald-500 border-emerald-500/20 opacity-60 cursor-not-allowed",
                    )}
                  >
                    <Phone size={14} />
                    Call
                  </button>
                  <button
                    type="button"
                    disabled
                    className={cn(
                      quickContact,
                      "bg-sky-400/12 text-sky-400 border-sky-400/20 opacity-60 cursor-not-allowed",
                    )}
                  >
                    <MessageSquare size={14} />
                    Text
                  </button>
                  <button
                    type="button"
                    disabled
                    className={cn(
                      quickContact,
                      "bg-indigo-400/12 text-indigo-400 border-indigo-400/20 opacity-60 cursor-not-allowed",
                    )}
                  >
                    <FileText size={14} />
                    Email
                  </button>
                </div>
              </div>

              {/* Notes */}
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Notes
                </p>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={pending}
                  placeholder="Add a note about this resolution..."
                  rows={4}
                  className="bg-gray-900 border-border resize-none"
                />
              </div>

              {resolveMutation.isError && (
                <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
                  <AlertTriangle size={14} className="shrink-0 text-destructive" />
                  <p className="text-xs text-destructive">
                    {(resolveMutation.error as Error).message ||
                      "Couldn't resolve this item. Try again."}
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 flex gap-3 border-t border-border">
              <Button
                variant="ghost"
                onClick={close}
                disabled={pending}
                className="flex-1 text-muted-foreground hover:text-slate-300 hover:bg-white/5"
              >
                Cancel
              </Button>
              <Button
                onClick={handleResolve}
                disabled={pending}
                className="flex-1 bg-gradient-to-br from-emerald-500 to-emerald-600 text-primary-foreground font-semibold hover:brightness-110 active:scale-95 shadow-[0_0_16px_rgba(16,185,129,0.25)]"
              >
                {pending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Resolving…
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    Mark Resolved
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
