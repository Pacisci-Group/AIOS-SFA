import { Loader2, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlatformUserRow } from "@/lib/platform-users-api";
import { cn } from "@/lib/utils";

/** User · Agency · Branch · Roles · Status · Action */
const GRID_COLS = "1.6fr 1.1fr 0.9fr 1.3fr 96px 128px";

const HEADERS = ["User", "Agency", "Branch", "Roles", "Status", ""];

interface PlatformUsersTableProps {
  users: PlatformUserRow[];
  isPending: boolean;
  pageSize: number;
  /** `false` hides the action column's button entirely (no permission). */
  canImpersonate: boolean;
  /** The row whose impersonation is in flight, if any. */
  impersonatingId: string | null;
  onImpersonate: (user: PlatformUserRow) => void;
}

/**
 * The user directory rows (PAC-70). CSS-grid rows rather than the `Table`
 * primitive, matching `LeadsTable` and the Users page.
 *
 * Six columns need ~880px; the panel's `max-w-5xl` main gives 1024, and below
 * that the `min-w` + `overflow-x-auto` pair scrolls the table inside its own
 * card rather than crushing the columns — usable at tablet width.
 */
export function PlatformUsersTable({
  users,
  isPending,
  pageSize,
  canImpersonate,
  impersonatingId,
  onImpersonate,
}: PlatformUsersTableProps) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[880px] overflow-hidden rounded-xl border border-border bg-card">
        <div
          className="grid gap-3 border-b border-border px-5 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"
          style={{ gridTemplateColumns: GRID_COLS }}
        >
          {HEADERS.map((header, i) => (
            <span key={header || `spacer-${i}`}>{header}</span>
          ))}
        </div>

        {isPending
          ? Array.from({ length: Math.min(pageSize, 8) }).map((_, i) => (
              <div
                key={i}
                className="grid items-center gap-3 border-b border-border px-5 py-3.5"
                style={{ gridTemplateColumns: GRID_COLS }}
              >
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-44" />
                </div>
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-7 w-24 justify-self-end" />
              </div>
            ))
          : users.map((user, i) => {
              const status = userStatus(user);
              const busy = impersonatingId === user.id;
              return (
                <div
                  key={user.id}
                  className={cn(
                    "grid items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/50",
                    i < users.length - 1 && "border-b border-border",
                  )}
                  style={{ gridTemplateColumns: GRID_COLS }}
                >
                  <div className="min-w-0">
                    <p className="truncate text-base font-medium text-foreground">
                      {user.name ?? (
                        <span className="text-muted-foreground">No name</span>
                      )}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {user.email}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">
                      {user.agency?.name ?? "—"}
                    </p>
                    {user.agency && (
                      <p className="truncate text-xs text-muted-foreground">
                        {user.agency.slug}
                      </p>
                    )}
                  </div>

                  <span className="truncate text-sm text-muted-foreground">
                    {user.branch?.name ?? "—"}
                  </span>

                  <div className="flex flex-wrap gap-1">
                    {user.roles.length === 0 ? (
                      <span className="text-sm text-muted-foreground">—</span>
                    ) : (
                      user.roles.map((role) => (
                        <Badge key={role.slug} size="sm" variant="secondary">
                          {role.name}
                        </Badge>
                      ))
                    )}
                  </div>

                  <Badge
                    size="sm"
                    variant="secondary"
                    className={cn(
                      "font-semibold",
                      status.tone === "active" && "bg-success/12 text-success",
                    )}
                  >
                    {status.label}
                  </Badge>

                  <span className="justify-self-end">
                    {canImpersonate && (
                      <Button
                        variant="outline"
                        size="sm"
                        // An inactive user cannot be impersonated — the API
                        // answers 404 — so the button says so up front.
                        disabled={!user.isActive || impersonatingId !== null}
                        onClick={() => onImpersonate(user)}
                        title={
                          user.isActive
                            ? `Sign in as ${user.name ?? user.email}`
                            : "Only active users can be impersonated"
                        }
                      >
                        {busy ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <UserCheck className="size-4" />
                        )}
                        Impersonate
                      </Button>
                    )}
                  </span>
                </div>
              );
            })}
      </div>
    </div>
  );
}

/**
 * Three states, not two: an inactive user with no `deactivatedAt` is an invite
 * that was never accepted, which reads very differently from "removed".
 */
function userStatus(user: PlatformUserRow): {
  label: string;
  tone: "active" | "muted";
} {
  if (user.isActive) return { label: "Active", tone: "active" };
  if (user.deactivatedAt) return { label: "Deactivated", tone: "muted" };
  return { label: "Invited", tone: "muted" };
}
