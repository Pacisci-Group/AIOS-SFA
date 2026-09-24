import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  USER_AVAILABILITIES,
  USER_AVAILABILITY_DESCRIPTIONS,
  USER_AVAILABILITY_LABELS,
  type UserAvailability,
} from '@sfa/shared';
import { ChevronsUpDown } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAuth } from '@/contexts/auth-context';
import { type AuthUser } from '@/lib/api-client';
import { updateMyAvailability } from '@/lib/profile-api';
import { cn } from '@/lib/utils';
import { AVAILABILITY_DOT_CLASS } from '@/components/common/AvailabilityBadge';

/**
 * The user's own "taking leads or not" switch (PAC-139 §6).
 *
 * Lives in the sidebar footer, under the profile chip, because David was
 * explicit that it must be reachable from any page — "they don't need to go
 * to three pages to set their status." Styled like the theme and log-out rows
 * it sits between rather than as a `Button`: that footer is a bespoke sidebar
 * affordance.
 *
 * On success the returned auth blob is written straight into the `['auth',
 * 'me']` query, which is what `AuthProvider` mirrors into `user` — no refetch,
 * and the dot changes the moment the API answers. `updateMyAvailability` has
 * already re-stored the persisted copy.
 */
export function AvailabilityToggle({
  collapsed = false,
}: {
  collapsed?: boolean;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: updateMyAvailability,
    onSuccess: (fresh: AuthUser) => {
      queryClient.setQueryData(['auth', 'me'], fresh);
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : 'Could not update your status.',
      ),
  });

  // The blob predates the field on a client that has not refetched yet.
  const current: UserAvailability = user?.availability ?? 'available';
  const label = USER_AVAILABILITY_LABELS[current];

  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        disabled={mutation.isPending}
        aria-label={`Status: ${label}. Change status`}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md py-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-60',
          collapsed ? 'justify-center px-0' : 'px-2.5',
        )}
      >
        {/* Same 16px footprint as the row icons above and below, so the
            column of glyphs stays aligned on the collapsed rail. */}
        <span
          aria-hidden
          className="flex size-4 shrink-0 items-center justify-center"
        >
          <span
            className={cn(
              'size-2.5 rounded-full transition-colors',
              AVAILABILITY_DOT_CLASS[current],
              mutation.isPending && 'animate-pulse',
            )}
          />
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left">{label}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
          </>
        )}
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">Status · {label}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent side="right" align="end" className="w-56">
        <DropdownMenuLabel>My status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(next) => {
            if (next !== current) {
              mutation.mutate(next as UserAvailability);
            }
          }}
        >
          {USER_AVAILABILITIES.map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn('size-2 rounded-full', AVAILABILITY_DOT_CLASS[value])}
                  />
                  {USER_AVAILABILITY_LABELS[value]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {USER_AVAILABILITY_DESCRIPTIONS[value]}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
