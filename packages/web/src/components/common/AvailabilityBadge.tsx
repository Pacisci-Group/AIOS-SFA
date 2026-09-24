import { USER_AVAILABILITY_LABELS, type UserAvailability } from "@sfa/shared";
import { Badge } from "@/components/ui/badge";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { cn } from "@/lib/utils";

/**
 * Dot colour per availability state (PAC-139 §6, §6a). `success` is the brand
 * emerald; `destructive` is the theme's amber (not red — see
 * `packages/web/CLAUDE.md`); Away is the muted grey of "not here", which keeps
 * the one warning colour for the state that is a choice rather than an
 * absence. One map, so the sidebar's own switch and the Manager view's Status
 * column can never disagree about what busy looks like.
 */
export const AVAILABILITY_DOT_CLASS: Record<UserAvailability, string> = {
  available: "bg-success",
  busy: "bg-destructive",
  away: "bg-muted-foreground",
};

export function AvailabilityDot({
  value,
  className,
}: {
  value: UserAvailability;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        AVAILABILITY_DOT_CLASS[value],
        className,
      )}
    />
  );
}

/**
 * The availability pill: dot + label. `null` — a deactivated user, whose
 * switch means nothing — reads `N/A` rather than a pill claiming a state.
 */
export function AvailabilityBadge({
  value,
  className,
}: {
  value: UserAvailability | null;
  className?: string;
}) {
  if (value === null) {
    return (
      <span className={cn("text-sm text-muted-foreground", className)}>
        {NOT_AVAILABLE}
      </span>
    );
  }
  return (
    <Badge variant="outline" size="sm" className={cn("gap-1.5", className)}>
      <AvailabilityDot value={value} />
      {USER_AVAILABILITY_LABELS[value]}
    </Badge>
  );
}
