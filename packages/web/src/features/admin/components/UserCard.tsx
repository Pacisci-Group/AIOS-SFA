import { Link } from "react-router-dom";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { userStatus, type AgencyUser } from "@/lib/users-api";
import { UserRowMenu } from "../UserRowMenu";
import {
  branchLabel,
  displayName,
  initials,
  STATUS_BADGE,
} from "./user-display";

interface UserCardProps {
  user: AgencyUser;
  branchNames: Map<string, string>;
  showBranch: boolean;
  canOpenPermissions: boolean;
}

/**
 * One employee as a card — phone and tablet, where the table's five columns
 * don't fit. The counterpart to `LeadCard`, and the same trade: every field the
 * table shows is still here, stacked, with the row menu pinned to the corner.
 */
export function UserCard({
  user,
  branchNames,
  showBranch,
  canOpenPermissions,
}: UserCardProps) {
  const status = userStatus(user);
  const name = displayName(user);

  return (
    <div className="relative flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:bg-muted/50">
      <Avatar className="size-8">
        <AvatarFallback className="bg-sidebar-accent text-xs font-bold text-sidebar-accent-foreground dark:bg-blue-900 dark:text-foreground">
          {initials(user)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
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
        <p className="truncate text-sm text-muted-foreground">{user.email}</p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge
            size="sm"
            className={cn("font-semibold", STATUS_BADGE[status].className)}
          >
            {STATUS_BADGE[status].label}
          </Badge>

          {user.roleIds.map((role) => (
            <Badge
              key={role._id}
              size="sm"
              className="bg-primary/12 font-normal text-primary"
            >
              {role.name}
            </Badge>
          ))}

          {showBranch && (
            <span
              className={cn(
                "text-sm",
                user.branchId ? "text-muted-foreground" : "text-destructive",
              )}
            >
              {branchLabel(user, branchNames)}
            </span>
          )}
        </div>
      </div>

      <span className="relative z-10">
        <UserRowMenu user={user} />
      </span>
    </div>
  );
}
