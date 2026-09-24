import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import {
  temperatureDot,
  temperatureText,
} from "@/features/lead/components/lead-display";
import { formatPhone, type UnclaimedLeadRow as PoolLead } from "@/lib/leads-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import { AssignProducerMenu } from "./AssignProducerMenu";

interface UnclaimedPoolRowProps {
  lead: PoolLead;
  isLast: boolean;
  /** Gated once by the panel, not re-derived here — see `UnclaimedPoolPanel`. */
  canAssign: boolean;
}

/** Matches `UnclaimedPoolPanel`'s header; the assign column only exists for those who have one. */
export function poolGridColumns(canAssign: boolean): string {
  return canAssign
    ? "minmax(0,1fr) 128px 132px 96px 188px"
    : "minmax(0,1fr) 128px 132px 96px";
}

export function UnclaimedPoolRow({
  lead,
  isLast,
  canAssign,
}: UnclaimedPoolRowProps) {
  return (
    <div
      className={cn(
        "grid items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50 md:px-5",
        !isLast && "border-b border-border",
      )}
      style={{ gridTemplateColumns: poolGridColumns(canAssign) }}
    >
      <div className="flex min-w-0 items-center gap-2">
        {/*
         * The temperature an office manager set, as a dot rather than a pill:
         * the row already carries a source badge, and two pills side by side
         * read as one control. The prototype drew a four-tier aging badge here
         * instead — dropped, because nothing computes those tiers and inventing
         * thresholds would put a number on a judgement nobody made.
         */}
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            temperatureDot[lead.temperature],
          )}
        />
        <Link
          to={`/leads/${lead.id}`}
          className="truncate text-sm font-semibold text-foreground hover:text-primary hover:underline"
        >
          {lead.name}
        </Link>
        <span className={cn("sr-only", temperatureText[lead.temperature])}>
          {lead.temperature}
        </span>
      </div>

      <Badge
        size="sm"
        className="w-fit max-w-full shrink-0 truncate bg-muted font-normal text-muted-foreground"
      >
        {lead.leadSource || "No source"}
      </Badge>

      {/*
       * `null` here is either "no phone on file" or "withheld because you could
       * not open this lead anyway" (the API decides, per `GET /leads/unclaimed`).
       * Both are genuinely unavailable to this viewer, so both read as N/A —
       * spelling out which would tell a producer a number exists.
       */}
      <span className="truncate text-xs text-muted-foreground">
        {lead.phone ? formatPhone(lead.phone) : NOT_AVAILABLE}
      </span>

      <span className="text-xs text-muted-foreground tabular-nums">
        {relativeTime(lead.arrivedAt)}
      </span>

      {canAssign && (
        <AssignProducerMenu leadId={lead.id} leadName={lead.name} />
      )}
    </div>
  );
}
