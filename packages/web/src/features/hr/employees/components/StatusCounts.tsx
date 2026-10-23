import type { EmployeeProfileStatus } from "@sfa/shared";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { STATUS_LABELS } from "../employee-display";

const ORDER: EmployeeProfileStatus[] = ["pending", "active", "terminated"];

/**
 * The three whole-agency counts (PAC-162), each a link to the list filtered
 * on it. The one the page is about is lit.
 */
export function StatusCounts({
  counts,
  active,
}: {
  counts: Record<EmployeeProfileStatus, number>;
  active?: EmployeeProfileStatus;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {ORDER.map((status) => (
        <Link
          key={status}
          to={status === "pending" ? "/hr/onboardings" : `/hr/employees?status=${status}`}
          className={cn(
            "rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary/40",
            active === status ? "border-primary/60" : "border-border",
          )}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {STATUS_LABELS[status]}
          </p>
          <p className="text-lg font-semibold tracking-tight text-card-foreground tabular-nums">
            {counts[status]}
          </p>
        </Link>
      ))}
    </div>
  );
}
