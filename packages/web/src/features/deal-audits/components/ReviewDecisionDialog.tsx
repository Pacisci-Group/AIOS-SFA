import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import {
  AUDIT_ITEMS_NOT_PASSED,
  AUDIT_NOTHING_FAILED,
  dealAuditReviewKey,
  reviewAudit,
  type DealAuditReviewItem,
} from "@/lib/deal-audits-api";
import { managementDashboardKey } from "@/lib/management-dashboard-api";
import { cn } from "@/lib/utils";
import { SENT_BACK_TEXT } from "./review-display";

export type ReviewDecision = "approve" | "send_back";

/**
 * Confirms Approve or Send back (PAC-106).
 *
 * **Send back** is `request_changes` on the wire: it lands the audit on
 * `Fail`, which the producer's board paints red with a Fix it action. Its note
 * is required — it is what the producer's card and the notification say — and
 * the failed items are listed so the manager sends back what they meant to.
 *
 * Stays open while the request is in flight and on a refusal: a 409 here means
 * the page was stale (someone else ruled, or the producer resubmitted), so the
 * page is refetched and the reason shown in place rather than in a toast over
 * a page that has moved on.
 */
export function ReviewDecisionDialog({
  dealId,
  clientName,
  decision,
  failedItems,
  onClose,
}: {
  dealId: string;
  clientName: string;
  decision: ReviewDecision | null;
  failedItems: DealAuditReviewItem[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [note, setNote] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  // A fresh dialog starts empty.
  useEffect(() => {
    if (decision) {
      setNote("");
      setRefusal(null);
    }
  }, [decision]);

  const sendBack = decision === "send_back";
  const trimmed = note.trim();

  const mutation = useMutation({
    mutationFn: () =>
      reviewAudit(
        dealId,
        sendBack
          ? { decision: "request_changes", notes: trimmed }
          : { decision: "approve", notes: trimmed || undefined },
      ),
    onSuccess: () => {
      toast.success(
        sendBack
          ? `Sent ${clientName}'s audit back to the producer.`
          : `Approved ${clientName}'s audit.`,
      );
      // Everything that shows an audit's state: the queue and this page, the
      // producer's board, the drawer's workflow + thread, the Manager view.
      void queryClient.invalidateQueries({ queryKey: ["deal-audits"] });
      void queryClient.invalidateQueries({ queryKey: ["audit-workflow", dealId] });
      void queryClient.invalidateQueries({ queryKey: ["audit-notes", dealId] });
      void queryClient.invalidateQueries({ queryKey: managementDashboardKey });
      onClose();
      navigate("/deal-audits");
    },
    onError: (error) => {
      const code =
        error instanceof ApiError &&
        typeof error.body === "object" &&
        error.body !== null &&
        "code" in error.body
          ? (error.body as { code?: string }).code
          : undefined;
      if (code === AUDIT_ITEMS_NOT_PASSED || code === AUDIT_NOTHING_FAILED) {
        void queryClient.invalidateQueries({
          queryKey: dealAuditReviewKey(dealId),
        });
      }
      setRefusal(error.message || "That didn't go through. Try again.");
    },
  });

  const canConfirm = !mutation.isPending && (!sendBack || trimmed.length > 0);

  return (
    <AlertDialog
      open={decision !== null}
      onOpenChange={(open) => !open && !mutation.isPending && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {sendBack ? "Send this audit back?" : "Approve this audit?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {sendBack
              ? "The failed items reopen on the producer's board with your notes, and they're notified. Items you passed stay passed when they resubmit."
              : "Every item has passed. The audit is signed off and leaves the queue."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {sendBack && failedItems.length > 0 && (
          <ul className="flex flex-col gap-1.5 text-sm">
            {failedItems.map((item) => (
              <li key={item.id}>
                <span className={cn("font-medium", SENT_BACK_TEXT)}>
                  {item.itemName}
                </span>
                {item.review.note ? (
                  <span className="text-muted-foreground">
                    {" "}
                    — {item.review.note}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="review-decision-note">
            {sendBack ? "What needs fixing?" : "Note (optional)"}
          </Label>
          <Textarea
            id="review-decision-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2000}
            rows={3}
            disabled={mutation.isPending}
            placeholder={
              sendBack
                ? "The producer sees this on their board and in the notification."
                : "Anything worth recording with the approval."
            }
            className="resize-none"
          />
        </div>

        {refusal && <p className="text-sm text-destructive">{refusal}</p>}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm}
            onClick={(event) => {
              // Keep the dialog up while the request is in flight; Radix
              // closes on action click by default.
              event.preventDefault();
              setRefusal(null);
              mutation.mutate();
            }}
          >
            {mutation.isPending && <Loader2 className="animate-spin" />}
            {sendBack ? "Send back" : "Approve"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
