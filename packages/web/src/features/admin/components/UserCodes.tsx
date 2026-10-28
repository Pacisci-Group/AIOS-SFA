import { NOT_AVAILABLE } from "@/lib/not-available";
import { cn } from "@/lib/utils";
import type { AgencyUser } from "@/lib/users-api";

/**
 * A person's Allstate codes (PAC-173) in the directory: Bind ID and
 * sub-producer code, each `N/A` when unset, and a single `N/A` when neither
 * is — without a Bind ID, Dash Reconciliation cannot credit a producer's
 * policies to them (it reads them as a former employee's, or as 1-800 on a
 * line Dash leaves unnamed), so the gap is worth seeing at a glance.
 *
 * `stack` for the table cell, `inline` for the mobile card's meta line.
 */
export function UserCodes({
  user,
  layout,
  className,
}: {
  user: AgencyUser;
  layout: "stack" | "inline";
  className?: string;
}) {
  const bindId = user.allstateBindId;
  const subCode = user.allstateSubProducerCode;

  if (!bindId && !subCode) {
    return (
      <span className={cn("text-sm text-muted-foreground", className)}>
        {layout === "inline" ? `Allstate codes ${NOT_AVAILABLE}` : NOT_AVAILABLE}
      </span>
    );
  }

  const parts = [
    { label: "Bind ID", value: bindId },
    { label: "Sub-producer", value: subCode },
  ];

  return (
    <div
      className={cn(
        "min-w-0 text-sm tabular-nums",
        layout === "stack" ? "flex flex-col" : "flex flex-wrap gap-x-3",
        className,
      )}
    >
      {parts.map(({ label, value }) => (
        <span key={label} className="truncate">
          <span className="text-muted-foreground">{label} </span>
          {value ? (
            <span className="text-foreground">{value}</span>
          ) : (
            <span className="text-muted-foreground">{NOT_AVAILABLE}</span>
          )}
        </span>
      ))}
    </div>
  );
}
