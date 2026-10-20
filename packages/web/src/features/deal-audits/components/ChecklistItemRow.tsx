import { Check, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/features/lead/components/lead-display";
import type {
  AuditItemVerdict,
  DealAuditReviewItem,
} from "@/lib/deal-audits-api";
import { cn } from "@/lib/utils";
import { useItemVerdict } from "../useItemVerdict";
import { EvidenceBlock } from "./EvidenceBlock";
import { SENT_BACK_SURFACE, SENT_BACK_TEXT } from "./review-display";

const VERDICT_STYLES: Record<AuditItemVerdict, string> = {
  pass: "border-success/30 bg-success/12 text-success hover:bg-success/16 hover:text-success",
  fail: cn(SENT_BACK_SURFACE, SENT_BACK_TEXT, "hover:bg-red-500/12"),
};

/**
 * One checklist item on the Deal Audit page: what the producer claimed, the
 * evidence behind it, and the manager's ruling (PAC-106).
 *
 * The two are kept visibly apart because they are two facts — the producer's
 * "resolved" is a claim, the manager's Pass is the verification, and only the
 * Pass counts towards Approve.
 *
 * The note saves when the box loses focus, so a manager can type and move on
 * to the next item without a Save button per row.
 */
export function ChecklistItemRow({
  item,
  dealId,
  canRule,
}: {
  item: DealAuditReviewItem;
  dealId: string;
  /** The audit is with this manager — otherwise the row is read-only. */
  canRule: boolean;
}) {
  const mutation = useItemVerdict(dealId);
  const saved = item.review.note ?? "";
  const [note, setNote] = useState(saved);

  // A save (or a refetch) replaces the stored note; follow it.
  useEffect(() => setNote(saved), [saved]);

  const verdict = item.review.verdict;
  const rule = (next: AuditItemVerdict) =>
    mutation.mutate({
      itemId: item.id,
      // Pressing the active ruling again withdraws it.
      verdict: verdict === next ? null : next,
    });
  const saveNote = () => {
    const trimmed = note.trim();
    if (trimmed !== saved) mutation.mutate({ itemId: item.id, note: trimmed });
  };

  const managerOnly = !item.producerVisible;

  return (
    <li className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-medium text-card-foreground">
              {item.itemName}
            </span>
            {managerOnly && (
              <Badge size="sm" variant="outline">
                Manager check
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {[item.category, producerClaim(item)].filter(Boolean).join(" · ")}
          </p>
        </div>

        <div
          role="group"
          aria-label={`Ruling on ${item.itemName}`}
          className="flex shrink-0 items-center gap-1.5"
        >
          {mutation.isPending && (
            <Loader2
              aria-label="Saving"
              className="size-4 animate-spin text-muted-foreground"
            />
          )}
          {(["pass", "fail"] as const).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant="outline"
              aria-pressed={verdict === option}
              disabled={!canRule || mutation.isPending}
              onClick={() => rule(option)}
              className={cn(
                "min-w-20",
                verdict === option && VERDICT_STYLES[option],
              )}
            >
              {option === "pass" ? <Check /> : <X />}
              {option === "pass" ? "Pass" : "Fail"}
            </Button>
          ))}
        </div>
      </div>

      {item.producerNote && (
        <blockquote className="border-l-2 border-border pl-3 text-sm text-muted-foreground">
          {item.producerNote}
        </blockquote>
      )}

      {(item.attachments.length > 0 || item.requiresUpload) && (
        <EvidenceBlock
          itemId={item.id}
          attachments={item.attachments}
          empty={{
            title: "No document on file",
            hint: "Fail it to send it back for the document, or pass it with a note saying why none is needed.",
          }}
        />
      )}

      {canRule ? (
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={saveNote}
          maxLength={2000}
          rows={2}
          aria-label={`Note on ${item.itemName}`}
          placeholder={
            verdict === "fail"
              ? "What needs fixing? The producer sees this note."
              : "Add a note (optional)"
          }
          className="resize-none"
        />
      ) : (
        item.review.note && (
          <p className="text-sm text-card-foreground">
            <span className="text-muted-foreground">Manager: </span>
            {item.review.note}
          </p>
        )
      )}

      {verdict && (
        <p
          className={cn(
            "text-xs",
            verdict === "pass" ? "text-success" : SENT_BACK_TEXT,
          )}
        >
          {verdict === "pass" ? "Passed" : "Failed"} by{" "}
          {item.review.reviewedByName ?? "a manager"}
          {item.review.reviewedAt
            ? ` · ${formatDate(item.review.reviewedAt)}`
            : ""}
          {verdict === "fail" && !item.review.note && canRule
            ? " — add a note so the producer knows what to fix"
            : ""}
        </p>
      )}
    </li>
  );
}

/**
 * Where the item stands, in a few words.
 *
 * "Resolved", not "producer resolved": a manager's pass resolves the item too,
 * so the flag alone cannot say who closed it.
 */
function producerClaim(item: DealAuditReviewItem): string {
  if (!item.producerVisible) return "checked against the application";
  if (item.isResolved && item.resolvedAt) {
    return `resolved ${formatDate(item.resolvedAt)}`;
  }
  if (item.isResolved) return "resolved";
  return item.requiresUpload
    ? "waiting on the producer's document"
    : "waiting on the producer";
}
