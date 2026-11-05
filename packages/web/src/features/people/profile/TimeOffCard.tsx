import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plane, Plus, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import type { PersonProfileView, PersonTimeOffPolicyView } from "@sfa/shared";
import { DetailCard } from "@/components/common/DetailCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { hrKeys } from "@/lib/hr-api";
import { peopleKeys, removeMember } from "@/lib/people-api";
import {
  formatBalance,
  summarizeTimeOff,
  timeOffKindLabel,
} from "@/features/hr/policies/time-off/time-off-display";

/**
 * The person's time off policies with their two numbers (PAC-162,
 * PAC-165): **Available** — what is left to ask for, the current balance
 * less approved leave not yet taken and requests still waiting — and the
 * **Balance** it is drawn from. The same numbers, from the same service,
 * as the person's own Time off page.
 *
 * Add / Remove and **Adjust balance** for HR admins; a removal keeps the
 * ledger so the balance resumes if they are ever re-added, which the dialog
 * says. **Record time off** for someone who may record (`hr:write` +
 * `agency:users:read`) on anybody's profile but their own, and a link to
 * the person's requests.
 */
export function TimeOffCard({
  profile,
  canManage,
  onAdd,
  onAdjust,
  onRecord,
  requestsHref,
}: {
  profile: PersonProfileView;
  canManage: boolean;
  onAdd: () => void;
  /** HR admins: adjust this policy's balance by hand. */
  onAdjust?: (policy: PersonTimeOffPolicyView) => void;
  /** Recorders, on somebody else's profile. */
  onRecord?: () => void;
  /** Where this person's requests are listed, for a viewer who may see them. */
  requestsHref?: string;
}) {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<PersonTimeOffPolicyView | null>(null);
  const policies = profile.timeOff?.policies ?? [];

  const remove = useMutation({
    mutationFn: (policy: PersonTimeOffPolicyView) => removeMember(policy.id, profile.user.id),
    onSuccess: async (_, policy) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: peopleKeys.profile(profile.user.id) }),
        queryClient.invalidateQueries({ queryKey: hrKeys.all }),
      ]);
      toast.success(`Removed from ${policy.name}.`);
      setRemoving(null);
    },
    onError: (failure) => {
      setRemoving(null);
      toast.error(failure instanceof ApiError ? failure.message : "Could not remove them.");
    },
  });

  return (
    <DetailCard
      title="Time off"
      icon={Plane}
      bodyless
      action={
        canManage || onRecord || requestsHref ? (
          <div className="flex flex-wrap items-center gap-1">
            {requestsHref && (
              <Button asChild variant="ghost" size="sm">
                <Link to={requestsHref}>Requests</Link>
              </Button>
            )}
            {onRecord && policies.length > 0 && (
              <Button variant="ghost" size="sm" onClick={onRecord}>
                Record time off
              </Button>
            )}
            {canManage && (
              <Button variant="ghost" size="sm" onClick={onAdd}>
                <Plus className="size-4" />
                Add to policy
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {policies.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">
          Not in any time off policy yet.
          {canManage ? " Add one above, or during onboarding." : ""}
        </p>
      ) : (
        <ul>
          {policies.map((policy, index) => (
            <li
              key={policy.id}
              className={
                index < policies.length - 1
                  ? "flex items-center gap-3 border-b border-border px-5 py-3"
                  : "flex items-center gap-3 px-5 py-3"
              }
            >
              <div className="min-w-0 flex-1">
                {canManage ? (
                  <Link
                    to={`/settings/hr-policies/${policy.id}`}
                    className="text-sm font-medium text-foreground hover:underline"
                  >
                    {policy.name}
                  </Link>
                ) : (
                  <p className="text-sm font-medium text-foreground">{policy.name}</p>
                )}
                <p className="truncate text-xs text-muted-foreground">
                  {timeOffKindLabel(policy.timeOff)} · {summarizeTimeOff(policy.timeOff)}
                </p>
              </div>
              {policy.balanceHours === null ? (
                <p className="text-base font-semibold text-foreground">Unlimited</p>
              ) : (
                <>
                  <div className="text-right">
                    <p className="text-base font-semibold tabular-nums text-foreground">
                      {formatBalance(policy.availableHours)}
                    </p>
                    <p className="text-xs text-muted-foreground">Available</p>
                  </div>
                  <div className="text-right">
                    <p className="text-base tabular-nums text-muted-foreground">
                      {formatBalance(policy.balanceHours)}
                    </p>
                    <p className="text-xs text-muted-foreground">Balance</p>
                  </div>
                </>
              )}
              {onAdjust && policy.balanceHours !== null && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Adjust the ${policy.name} balance`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => onAdjust(policy)}
                >
                  <SlidersHorizontal className="size-4" />
                </Button>
              )}
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove from ${policy.name}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setRemoving(policy)}
                >
                  <X className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        {removing && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove from {removing.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                {profile.user.name} can no longer request this kind of time off until they are in
                another {timeOffKindLabel(removing.timeOff)} policy.
                {removing.balanceHours !== null
                  ? ` Their balance of ${formatBalance(removing.balanceHours)} stays on record and resumes if they are added back.`
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={remove.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  remove.mutate(removing);
                }}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </DetailCard>
  );
}
