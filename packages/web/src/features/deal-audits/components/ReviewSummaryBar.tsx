import { CheckCircle2, Undo2 } from "lucide-react";
import { DetailCard } from "@/components/common/DetailCard";
import { DisabledHint } from "@/components/common/DisabledHint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatDate } from "@/features/lead/components/lead-display";
import type { DealAuditReviewView } from "@/lib/deal-audits-api";
import { cn } from "@/lib/utils";
import {
  AUDIT_STATUS_LABELS,
  AUDIT_STATUS_STYLES,
  SENT_BACK_SURFACE,
  SENT_BACK_TEXT,
  waitingHint,
} from "@/components/audit/review-display";

/** How many names a disabled Approve's hint lists before "and N more". */
const UNMET_NAMES_SHOWN = 4;

/**
 * The running tally and the two decisions (PAC-106), pinned beside the
 * checklist.
 *
 * **Approve** needs every item passed (decided 19 Oct 2026); **Send back**
 * needs at least one failed. Both are enabled from the server's
 * `canApprove` / `canSendBack`, never re-derived here, and a disabled one says
 * why — in its hint, and in the line under the counts for anyone who cannot
 * hover.
 */
export function ReviewSummaryBar({
  audit,
  onApprove,
  onSendBack,
}: {
  audit: DealAuditReviewView["audit"];
  onApprove: () => void;
  onSendBack: () => void;
}) {
  const { passed, failed, remaining } = audit.counts;
  const total = passed + failed + remaining;
  const isPending = audit.auditStatus === "Pending";

  const approveHint = audit.canApprove
    ? undefined
    : !audit.canReview
      ? "This audit isn't yours to review right now."
      : `Still to pass: ${unmetNames(audit.unmet.map((item) => item.itemName))}`;
  const sendBackHint = audit.canSendBack
    ? undefined
    : !audit.canReview
      ? "This audit isn't yours to review right now."
      : "Fail at least one item to send the audit back.";

  return (
    <DetailCard
      title="Review"
      action={
        <Badge
          size="sm"
          className={cn("border-transparent", AUDIT_STATUS_STYLES[audit.auditStatus])}
        >
          {AUDIT_STATUS_LABELS[audit.auditStatus]}
        </Badge>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-3 gap-3 text-center">
          <Tally label="Passed" value={passed} className="text-success" />
          <Tally label="Failed" value={failed} className={SENT_BACK_TEXT} />
          <Tally
            label="Remaining"
            value={remaining}
            className="text-card-foreground"
          />
        </dl>
        <Progress
          value={total ? Math.round((passed / total) * 100) : 0}
          className="h-1.5"
          aria-label={`${passed} of ${total} items passed`}
        />

        <StatusNote audit={audit} />

        {isPending && (
          <div className="flex flex-col gap-2">
            <DisabledHint hint={approveHint} className="w-full">
              <Button
                variant="success"
                className="w-full"
                disabled={!audit.canApprove}
                onClick={onApprove}
              >
                <CheckCircle2 />
                Approve
              </Button>
            </DisabledHint>
            <DisabledHint hint={sendBackHint} className="w-full">
              <Button
                variant="outline"
                className={cn("w-full", audit.canSendBack && SENT_BACK_TEXT)}
                disabled={!audit.canSendBack}
                onClick={onSendBack}
              >
                <Undo2 />
                Send back
              </Button>
            </DisabledHint>
          </div>
        )}
      </div>
    </DetailCard>
  );
}

function Tally({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={cn("text-lg font-semibold tabular-nums", className)}>
        {value}
      </dd>
    </div>
  );
}

/** The sentence under the counts: what is happening, and what is left. */
function StatusNote({ audit }: { audit: DealAuditReviewView["audit"] }) {
  if (audit.auditStatus === "Fail" && audit.sentBack) {
    return (
      <div className={cn("rounded-lg border px-3 py-2.5 text-sm", SENT_BACK_SURFACE)}>
        <p className={cn("font-medium", SENT_BACK_TEXT)}>
          Sent back by {audit.sentBack.byName ?? "a manager"} ·{" "}
          {formatDate(audit.sentBack.at)}
        </p>
        {audit.sentBack.note && (
          <p className="mt-1 text-card-foreground">{audit.sentBack.note}</p>
        )}
        <p className="mt-1 text-muted-foreground">Waiting for the producer.</p>
      </div>
    );
  }
  if (audit.auditStatus === "Pass") {
    return (
      <p className="text-sm text-muted-foreground">
        Approved{audit.reviewedAt ? ` ${formatDate(audit.reviewedAt)}` : ""}.
      </p>
    );
  }
  const waiting = waitingHint(audit.auditStatus);
  if (waiting) {
    return <p className="text-sm text-muted-foreground">{waiting}.</p>;
  }
  if (!audit.canReview) {
    // Pending, but the one rule the server enforces on top: not your own.
    return (
      <p className="text-sm text-muted-foreground">
        You submitted this audit, so another manager has to review it.
      </p>
    );
  }
  if (audit.unmet.length > 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Pass every item to approve; fail any to send it back.
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      Every item has passed — ready to approve.
    </p>
  );
}

function unmetNames(names: string[]): string {
  const shown = names.slice(0, UNMET_NAMES_SHOWN).join(", ");
  const more = names.length - UNMET_NAMES_SHOWN;
  return more > 0 ? `${shown} and ${more} more` : shown;
}
