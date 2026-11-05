import { Link } from "react-router-dom";
import type { TimeOffRequestRow } from "@sfa/shared";
import { Badge } from "@/components/ui/badge";
import { formatBalance } from "@/features/hr/policies/time-off/time-off-display";
import { cn } from "@/lib/utils";
import {
  GROUP_BADGE,
  requestDates,
  requestPolicyName,
  requestReference,
} from "./time-off-request-display";

/**
 * A request in a list (PAC-165) — the employee's own list and the team
 * list render the same row; the team list leads with whose it is. The whole
 * row is one link to the request, the People list's stretched-link idiom.
 */
export function RequestRow({
  row,
  to,
  showEmployee = false,
  badgeLabel,
}: {
  row: TimeOffRequestRow;
  to: string;
  showEmployee?: boolean;
  /** The team list calls `pending` "To review". */
  badgeLabel?: string;
}) {
  const badge = GROUP_BADGE[row.group];
  return (
    <li className="relative flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-muted/50">
      <div className="min-w-0 flex-1 basis-56">
        <Link
          to={to}
          className="block truncate text-base font-medium text-foreground after:absolute after:inset-0 after:content-['']"
        >
          {showEmployee ? (row.employee?.name ?? "Unknown person") : requestPolicyName(row)}
        </Link>
        <p className="truncate text-sm text-muted-foreground">
          {showEmployee ? `${requestPolicyName(row)} · ` : ""}
          {requestReference(row)}
          {row.recordedBy ? ` · Recorded by ${row.recordedBy.name}` : ""}
          {row.autoApproved ? " · Approved automatically" : ""}
        </p>
      </div>
      <p className="basis-44 text-sm text-foreground">{requestDates(row)}</p>
      <p className="basis-16 text-right text-sm font-medium tabular-nums text-foreground">
        {formatBalance(row.totalHours)}
      </p>
      <Badge
        size="sm"
        className={cn("basis-auto justify-self-end font-semibold", badge.className)}
      >
        {badgeLabel ?? badge.label}
      </Badge>
    </li>
  );
}
