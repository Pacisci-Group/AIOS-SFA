import { Link } from "react-router-dom";
import { UserAvatar } from "@/components/common/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AgencyUser } from "@/lib/users-api";
import { PersonRowMenu } from "./PersonRowMenu";
import {
  AVATAR_FALLBACK_CLASS,
  branchLabel,
  displayName,
  STATUS_BADGE,
} from "./person-display";

/** Person · Role · Branch · Status · Actions */
const GRID_COLS = "1.6fr 1fr 1fr 150px 40px";
/** Without the branch column, which needs `agency:branches:read` to populate. */
const GRID_COLS_NO_BRANCH = "1.6fr 1fr 150px 40px";

interface PeopleTableProps {
  users: AgencyUser[];
  isPending: boolean;
  /** Branch id → name. Empty when the caller cannot read branches. */
  branchNames: Map<string, string>;
  showBranch: boolean;
}

/**
 * Desktop People list (PAC-162; the agency directory of PAC-101).
 *
 * CSS-grid rows rather than the `Table` primitive, matching `LeadsTable` — the
 * two lists are the same object at different scales and should not look like
 * two different apps. Column widths, header treatment, row padding, hover and
 * the stretched-link pattern are all lifted from it deliberately.
 *
 * A row opens the person's **profile** (`/people/:userId`); the permissions
 * page it used to open is in the ⋯ menu and on the profile's Role card. The
 * photo is the real one when there is one (`UserAvatar` fetches it with the
 * auth header — an `<img src>` would 401).
 *
 * The **Branch** column is conditional. It is the one fact about an employee
 * this directory could never show, and now that the invite form assigns a
 * branch it is also the one most likely to be wrong — but populating it needs
 * `agency:branches:read`, which the directory itself does not require. When
 * that read is refused the column is dropped rather than filled with ids.
 */
export function PeopleTable({
  users,
  isPending,
  branchNames,
  showBranch,
}: PeopleTableProps) {
  const columns = showBranch ? GRID_COLS : GRID_COLS_NO_BRANCH;
  const headers = showBranch
    ? ["Person", "Role", "Branch", "Status", ""]
    : ["Person", "Role", "Status", ""];

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
                    <UserAvatar
                      name={name}
                      avatarUrl={user.avatarUrl}
                      className="size-8"
                      fallbackClassName={AVATAR_FALLBACK_CLASS}
                    />
                    <div className="min-w-0">
                      {/* The stretched link is the row's primary action. */}
                      <Link
                        to={`/people/${user._id}`}
                        className="block truncate text-base font-medium text-foreground after:absolute after:inset-0 after:content-['']"
                      >
                        {name}
                      </Link>
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
                    className={cn(
                      "font-semibold",
                      STATUS_BADGE[user.status].className,
                    )}
                  >
                    {STATUS_BADGE[user.status].label}
                  </Badge>

                  {/* Above the stretched link so its clicks don't navigate. */}
                  <span className="relative z-10 justify-self-end">
                    <PersonRowMenu user={user} />
                  </span>
                </div>
              );
            })}
      </div>
    </div>
  );
}
