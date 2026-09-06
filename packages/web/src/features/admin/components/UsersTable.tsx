import { Link } from "react-router-dom";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { userStatus, type AgencyUser } from "@/lib/users-api";
import { UserRowMenu } from "../UserRowMenu";
import {
  branchLabel,
  displayName,
  initials,
  STATUS_BADGE,
} from "./user-display";

/** User · Role · Branch · Status · Actions */
const GRID_COLS = "1.6fr 1fr 1fr 110px 40px";
/** Without the branch column, which needs `agency:branches:read` to populate. */
const GRID_COLS_NO_BRANCH = "1.6fr 1fr 110px 40px";

interface UsersTableProps {
  users: AgencyUser[];
  isPending: boolean;
  /** Branch id → name. Empty when the caller cannot read branches. */
  branchNames: Map<string, string>;
  showBranch: boolean;
  /** Whether row-level navigation to the permissions page is allowed. */
  canOpenPermissions: boolean;
}

/**
 * Desktop agency directory.
 *
 * CSS-grid rows rather than the `Table` primitive, matching `LeadsTable` — the
 * two lists are the same object at different scales and should not look like
 * two different apps. Column widths, header treatment, row padding, hover and
 * the stretched-link pattern are all lifted from it deliberately.
 *
 * The **Branch** column is conditional. It is the one fact about an employee
 * this directory could never show, and now that the invite form assigns a
 * branch it is also the one most likely to be wrong — but populating it needs
 * `agency:branches:read`, which the directory itself does not require. When
 * that read is refused the column is dropped rather than filled with ids.
 */
export function UsersTable({
  users,
  isPending,
  branchNames,
  showBranch,
  canOpenPermissions,
}: UsersTableProps) {
  const columns = showBranch ? GRID_COLS : GRID_COLS_NO_BRANCH;
  const headers = showBranch
    ? ["User", "Role", "Branch", "Status", ""]
    : ["User", "Role", "Status", ""];

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px] overflow-hidden rounded-xl border border-border bg-card">
        <div
          className="grid gap-3 border-b border-border px-5 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"
          style={{ gridTemplateColumns: columns }}
        >
          {headers.map((header, i) => (
            <span key={header || `spacer-${i}`}>{header}</span>
          ))}
        </div>

        {isPending
          ? Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="grid items-center gap-3 border-b border-border px-5 py-3.5"
                style={{ gridTemplateColumns: columns }}
              >
                <div className="flex items-center gap-3">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                </div>
                <Skeleton className="h-5 w-20 rounded-full" />
                {showBranch && <Skeleton className="h-3 w-24" />}
                <Skeleton className="h-5 w-16 rounded-full" />
                <span />
              </div>
            ))
          : users.map((user, i) => {
              const status = userStatus(user);
              const name = displayName(user);

              return (
                <div
                  key={user._id}
                  className={cn(
                    "relative grid items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/50",
                    i < users.length - 1 && "border-b border-border",
                  )}
                  style={{ gridTemplateColumns: columns }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="size-8">
                      {/* The whole fallback chip needs a light variant, not
                          just the text: `blue-900` stays dark whatever the
                          theme, so recolouring only the text trades dark-on-dark
                          for blue-on-blue. Same pair as the sidebar chip. */}
                      <AvatarFallback className="bg-sidebar-accent text-xs font-bold text-sidebar-accent-foreground dark:bg-blue-900 dark:text-foreground">
                        {initials(user)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      {/*
                        The stretched link is the row's primary action, and it
                        only exists when the permissions route would actually
                        admit the viewer — it is gated on `agency:roles:read`,
                        so a directory-only reader used to be redirected to the
                        landing page by clicking any row.
                      */}
                      {canOpenPermissions ? (
                        <Link
                          to={`/settings/users/${user._id}/permissions`}
                          className="block truncate text-base font-medium text-foreground after:absolute after:inset-0 after:content-['']"
                        >
                          {name}
                        </Link>
                      ) : (
                        <p className="truncate text-base font-medium text-foreground">
                          {name}
                        </p>
                      )}
                      <p className="truncate text-sm text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-wrap gap-1">
                    {user.roleIds.length ? (
                      user.roleIds.map((role) => (
                        <Badge
                          key={role._id}
                          size="sm"
                          className="bg-primary/12 font-normal text-primary"
                        >
                          {role.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        No role
                      </span>
                    )}
                  </div>

                  {showBranch && (
                    <span
                      className={cn(
                        "truncate text-sm",
                        user.branchId
                          ? "text-muted-foreground"
                          : "text-destructive",
                      )}
                    >
                      {branchLabel(user, branchNames)}
                    </span>
                  )}

                  <Badge
                    size="sm"
                    className={cn("font-semibold", STATUS_BADGE[status].className)}
                  >
                    {STATUS_BADGE[status].label}
                  </Badge>

                  {/* Above the stretched link so its clicks don't navigate. */}
                  <span className="relative z-10 justify-self-end">
                    <UserRowMenu user={user} />
                  </span>
                </div>
              );
            })}
      </div>
    </div>
  );
}
