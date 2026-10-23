import { Link } from "react-router-dom";
import type { EmployeeListItem } from "@sfa/shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_STATUS_LABELS,
  STATUS_BADGE_CLASS,
  STATUS_LABELS,
  daysSince,
  employeeName,
  formatDay,
  initialsOf,
} from "../employee-display";

/** Person · Branch · Policy · Schedule · Dates · Status */
const GRID_COLS = "1.7fr 1fr 1.1fr 1fr 1fr 130px";

interface EmployeesTableProps {
  items: EmployeeListItem[];
  isPending: boolean;
  /** The Onboardings list says "pending since"; the Employees list says the hire date. */
  variant: "onboardings" | "employees";
  /** The row to highlight — a notification deep link (`?user=`). */
  highlightUserId?: string | null;
}

/**
 * The HR lists (PAC-162): CSS-grid rows like `UsersTable`, so the directory
 * and the HR roster read as one app. The whole row links to the person's
 * HR record through the stretched-link pattern.
 */
export function EmployeesTable({
  items,
  isPending,
  variant,
  highlightUserId,
}: EmployeesTableProps) {
  const headers = [
    "Person",
    "Branch",
    "Leave policy",
    "Schedule",
    variant === "onboardings" ? "Pending since" : "Hired",
    "Status",
  ];

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[860px] overflow-hidden rounded-xl border border-border bg-card">
        <div
          className="grid gap-3 border-b border-border px-5 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"
          style={{ gridTemplateColumns: GRID_COLS }}
        >
          {headers.map((header) => (
            <span key={header}>{header}</span>
          ))}
        </div>

        {isPending
          ? Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="grid items-center gap-3 border-b border-border px-5 py-3.5"
                style={{ gridTemplateColumns: GRID_COLS }}
              >
                <div className="flex items-center gap-3">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                </div>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            ))
          : items.map((item, i) => {
              const name = employeeName(item.user);
              return (
                <div
                  key={item.id}
                  className={cn(
                    "relative grid items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/50",
                    i < items.length - 1 && "border-b border-border",
                    highlightUserId === item.userId && "bg-primary/5",
                  )}
                  style={{ gridTemplateColumns: GRID_COLS }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="size-8">
                      <AvatarFallback className="bg-sidebar-accent text-xs font-bold text-sidebar-accent-foreground dark:bg-blue-900 dark:text-foreground">
                        {initialsOf(item.user)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <Link
                        to={`/hr/employees/${item.userId}`}
                        className="block truncate text-base font-medium text-foreground after:absolute after:inset-0 after:content-['']"
                      >
                        {name}
                      </Link>
                      <p className="truncate text-sm text-muted-foreground">
                        {item.user.roleNames.join(", ") || item.user.email}
                        {item.user.accountStatus !== "active" && (
                          <> · {ACCOUNT_STATUS_LABELS[item.user.accountStatus]}</>
                        )}
                      </p>
                    </div>
                  </div>

                  <span className="truncate text-sm text-muted-foreground">
                    {item.user.branchName ?? NOT_AVAILABLE}
                  </span>

                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">
                      {item.leavePolicy?.name ?? NOT_AVAILABLE}
                    </p>
                    {item.customRuleCount > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {item.customRuleCount} custom rule
                        {item.customRuleCount === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>

                  <span className="truncate text-sm text-muted-foreground">
                    {item.scheduleTemplateName ?? "Agency workweek"}
                  </span>

                  <span className="text-sm text-muted-foreground tabular-nums">
                    {variant === "onboardings"
                      ? daysSince(item.createdAt)
                      : formatDay(item.hireDate)}
                  </span>

                  <Badge
                    size="sm"
                    className={cn("border-transparent", STATUS_BADGE_CLASS[item.status])}
                  >
                    {STATUS_LABELS[item.status]}
                  </Badge>
                </div>
              );
            })}
      </div>
    </div>
  );
}
