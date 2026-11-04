import { Link } from "react-router-dom";
import { UserAvatar } from "@/components/common/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgencyUser } from "@/lib/users-api";
import { PersonRowMenu } from "./PersonRowMenu";
import {
  AVATAR_FALLBACK_CLASS,
  branchLabel,
  displayName,
  STATUS_BADGE,
} from "./person-display";

interface PersonCardProps {
  user: AgencyUser;
  branchNames: Map<string, string>;
  showBranch: boolean;
}

/**
 * One person as a card — phone and tablet, where the table's five columns
 * don't fit. The counterpart to `LeadCard`, and the same trade: every field the
 * table shows is still here, stacked, with the row menu pinned to the corner.
 * The card opens the profile, as the table row does.
 */
export function PersonCard({ user, branchNames, showBranch }: PersonCardProps) {
  const name = displayName(user);

  return (
    <div className="relative flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:bg-muted/50">
      <UserAvatar
        name={name}
        avatarUrl={user.avatarUrl}
        className="size-8"
        fallbackClassName={AVATAR_FALLBACK_CLASS}
      />

      <div className="min-w-0 flex-1">
        <Link
          to={`/people/${user._id}`}
          className="block truncate text-base font-medium text-foreground after:absolute after:inset-0 after:content-['']"
        >
          {name}
        </Link>
        <p className="truncate text-sm text-muted-foreground">{user.email}</p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge
            size="sm"
            className={cn("font-semibold", STATUS_BADGE[user.status].className)}
          >
            {STATUS_BADGE[user.status].label}
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
        <PersonRowMenu user={user} />
      </span>
    </div>
  );
}
