import {
  Upload,
  Phone,
  ExternalLink,
  PhoneCall,
  MessageSquare,
  CheckCircle2,
  FileText,
  AlertTriangle,
  ChevronDown,
  X,
  Loader2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  getAuditAttachmentUrl,
  resolveWithOptionalUpload,
  type DealAuditDealRow,
  type DealAuditItemRow,
  type DealAuditRowAttachment,
} from "@/lib/deal-audits-api";
import { AuditWorkflowPanel } from "./AuditWorkflowPanel";

interface ResolvePanelProps {
  deal: DealAuditDealRow | null;
  onClose: () => void;
  onResolved: (dealRowId: string, itemId: string) => void;
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
 * Two presentations of one requirement, and which one shows is the whole point
 * of the rule that the audit fires whether or not a document was uploaded:
 *
 *  - **A document is attached** — surface it here so they verify it in place.
 *    Producers have uploaded these since PAC-56 #21b and nothing ever read
 *    them, so the service team was chasing files already sitting in storage.
 *  - **Nothing attached** — say so, and say what to do instead. An absent
 *    evidence block would read as "no evidence needed".
 *
 * The URL is fetched on click because presigned links expire; a panel left open
 * would otherwise hand out dead ones.
 *
 * ⚠ Load-bearing and recently shipped. It moved from the panel root to inside
 * each requirement when the drawer became deal-scoped (PAC-72); it must not be
 * lost in that rework.
 */
function EvidenceBlock({ item }: { item: DealAuditItemRow }) {
  const [opening, setOpening] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (file: DealAuditRowAttachment) => {
    setOpening(file.index);
    setError(null);
    try {
      const { downloadUrl } = await getAuditAttachmentUrl(item.id, file.index);
      window.open(downloadUrl, "_blank", "noopener");
    } catch {
      setError("Could not open that document. Try again.");
    } finally {
      setOpening(null);
    }
  };

  if (item.attachments.length === 0) {
    return (
      <div className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/8 p-3">
        <PhoneCall size={15} className="mt-0.5 shrink-0 text-amber-500" />
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
      <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
        Evidence on file
      </p>
      <div className="flex flex-col gap-2">
        {item.attachments.map((file) => (
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

/**
 * One requirement, expanding in place to the resolve form.
 *
 * ⚠ **A settled requirement carries no checkmark** (PAC-72 section A item 4).
 * David rejected them explicitly; the deal's completion percentage at the top
 * of the drawer is what replaced them. Settled rows are distinguished by muted
 * type and the absence of the amber marker, nothing more.
 */
function RequirementRow({
  item,
  expanded,
  onToggle,
  onResolved,
}: {
  item: DealAuditItemRow;
  expanded: boolean;
  onToggle: () => void;
  onResolved: (itemId: string) => void;
}) {
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
  const dueLabel = item.dueAt ? formatDue(item.dueAt) : null;

  const resolveMutation = useMutation({
    mutationFn: () => resolveWithOptionalUpload(item.id, { note, file }),
    onSuccess: () => onResolved(item.id),
  });

  // Collapsing has to clear the draft, or reopening a different requirement
  // would inherit the last one's note and file.
  useEffect(() => {
    if (!expanded) {
      setFile(null);
      setNote("");
      setFileError(null);
      resolveMutation.reset();
    }
    // `resolveMutation` is recreated each render; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

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

  const pending = resolveMutation.isPending;

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors",
        item.open
          ? "border-amber-500/20 bg-amber-500/8"
          : "border-border bg-muted/30",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={!item.open}
        className="flex w-full items-center gap-3 px-3 py-3 text-left disabled:cursor-default"
      >
        {item.open ? (
          <AlertTriangle size={15} className="shrink-0 text-amber-500" />
        ) : (
          <span className="h-[15px] w-[15px] shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm",
              item.open
                ? "font-medium text-foreground"
                : "text-muted-foreground line-through decoration-border",
            )}
          >
            {item.missing}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {item.open
              ? `Open ${item.daysOpen} day${item.daysOpen === 1 ? "" : "s"}${
                  dueLabel ? ` · ${dueLabel}` : ""
                }`
              : "Resolved"}
            {item.open && item.attachments.length > 0
              ? " · document on file"
              : ""}
          </span>
        </span>
        {item.open && (
          <ChevronDown
            size={15}
            className={cn(
              "shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        )}
      </button>

      {expanded && item.open && (
        <div className="flex flex-col gap-4 border-t border-border/60 px-3 py-4">
          <EvidenceBlock item={item} />

          {/* Upload */}
          <div>
            <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              Upload document{" "}
              <span className="normal-case tracking-normal text-muted-foreground/70">
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
              <div className="flex items-center gap-3 rounded-xl border border-border bg-sunken p-3">
                <FileText size={18} className="shrink-0 text-sky-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">
                    {file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(file.size)}
                  </p>
                </div>
                {!pending && (
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
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
                  "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 transition-all",
                  dragging
                    ? "border-sky-400 bg-sky-400/5"
                    : "border-border bg-sunken",
                )}
              >
                <Upload size={24} className="text-muted-foreground" />
                <p className="text-center text-sm text-muted-foreground">
                  Drop file here or{" "}
                  <span className="font-medium text-sky-400">
                    browse to upload
                  </span>
                </p>
                <p className="text-xs text-muted-foreground/70">
                  PDF, JPG, PNG up to 10MB
                </p>
              </div>
            )}

            {fileError && (
              <p className="mt-2 text-xs text-destructive">{fileError}</p>
            )}
          </div>

          {/* Note */}
          <div>
            <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              Notes
            </p>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={pending}
              placeholder="Add a note about this resolution..."
              rows={3}
              className="resize-none border-border bg-sunken"
            />
          </div>

          {resolveMutation.isError && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2">
              <AlertTriangle size={14} className="shrink-0 text-destructive" />
              <p className="text-xs text-destructive">
                {(resolveMutation.error as Error).message ||
                  "Couldn't resolve this requirement. Try again."}
              </p>
            </div>
          )}

          <Button
            onClick={() => !pending && resolveMutation.mutate()}
            disabled={pending}
            className="bg-gradient-to-br from-emerald-500 to-emerald-600 font-semibold text-primary-foreground shadow-[0_0_16px_rgba(16,185,129,0.25)] hover:brightness-110 active:scale-95"
          >
            {pending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Resolving…
              </>
            ) : (
              <>
                <CheckCircle2 size={16} />
                Mark resolved
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The deal's audit, resolvable in place (PAC-72 section A item 2).
 *
 * Still a **drawer**, not a modal: the 07/22 scrum said side drawer and the
 * 07/23 one said modal, a day apart with nothing marking the second as a
 * reversal — and the CRM policy-drawer decision from that same 07/22 call was
 * explicitly a drawer to avoid navigation fatigue. Ask David rather than
 * building it twice.
 */
export function ResolvePanel({ deal, onClose, onResolved }: ResolvePanelProps) {
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  // Open the first outstanding requirement when the drawer opens on a new deal
  // — it is what the auditor came for, and the server already sorted it first.
  useEffect(() => {
    setActiveItemId(deal?.items.find((item) => item.open)?.id ?? null);
  }, [deal?.id, deal?.items]);

  const close = () => {
    setActiveItemId(null);
    onClose();
  };

  return (
    <Sheet open={!!deal} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-l border-border p-0 sm:w-[440px] sm:max-w-[440px] dark:border-white/[0.08]"
      >
        {deal && (
          <>
            <SheetHeader className="gap-1 border-b border-border px-6 py-5">
              <SheetDescription className="text-xs uppercase tracking-widest text-amber-500">
                Service hand-off · {deal.ref}
              </SheetDescription>
              <SheetTitle className="font-semibold text-foreground">
                {deal.client}
              </SheetTitle>

              {/*
                * The completion percentage, at the top of the deal view
                * (section A item 3) — and the reason there are no checkmarks
                * on the requirements below (item 4).
                */}
              <div className="mt-3 flex items-center gap-3">
                <Progress
                  value={deal.completionPct}
                  className="h-1.5 flex-1"
                  aria-label={`${deal.completionPct}% of requirements resolved`}
                />
                <span className="shrink-0 text-xs font-semibold text-foreground tabular-nums">
                  {deal.completionPct}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {deal.openCount} of {deal.itemCount} requirements outstanding
              </p>
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
              {/*
                * Ownership, the review workflow and the note thread (section E).
                * Above the checklist because it answers "who is on this and
                * where is it" — the question you ask before working the items.
                */}
              <AuditWorkflowPanel dealId={deal.dealId} />

              <div className="flex flex-col gap-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Requirements
                </p>
                {/*
                  * Rendered in the order the server sent: outstanding first,
                  * oldest first (section A item 5). Sorting again here would
                  * be a second opinion that could disagree with pagination.
                  */}
                {deal.items.map((item) => (
                  <RequirementRow
                    key={item.id}
                    item={item}
                    expanded={activeItemId === item.id}
                    onToggle={() =>
                      setActiveItemId((current) =>
                        current === item.id ? null : item.id,
                      )
                    }
                    onResolved={(itemId) => onResolved(deal.id, itemId)}
                  />
                ))}
              </div>

              {/* Quick contact (decorative — wired in a later story) */}
              <div>
                <p className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
                  Quick Contact
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled
                    className={cn(
                      quickContact,
                      "cursor-not-allowed border-emerald-500/20 bg-emerald-500/12 text-emerald-500 opacity-60",
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
                      "cursor-not-allowed border-sky-400/20 bg-sky-400/12 text-sky-400 opacity-60",
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
                      "cursor-not-allowed border-indigo-400/20 bg-indigo-400/12 text-indigo-400 opacity-60",
                    )}
                  >
                    <FileText size={14} />
                    Email
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t border-border px-6 py-4">
              <Button
                variant="outline"
                onClick={close}
                className="w-full text-muted-foreground"
              >
                Close
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
