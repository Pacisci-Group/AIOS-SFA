import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plane, Plus, X } from "lucide-react";
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
 * The person's time off policies with their **current balance** (PAC-162)
 * — the sum of their ledger rows; "Available" (minus pending and future
 * approved leave) arrives with PAC-165 and its definitions. Add / Remove
 * for HR admins; a removal keeps the ledger so the balance resumes if they
 * are ever re-added, which the dialog says.
 */
export function TimeOffCard({
  profile,
  canManage,
  onAdd,
}: {
  profile: PersonProfileView;
  canManage: boolean;
  onAdd: () => void;
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
        canManage ? (
          <Button variant="ghost" size="sm" onClick={onAdd}>
            <Plus className="size-4" />
            Add to policy
          </Button>
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
              <div className="text-right">
                <p className="text-base font-semibold text-foreground">
                  {formatBalance(policy.balanceHours)}
                </p>
                <p className="text-xs text-muted-foreground">Balance</p>
              </div>
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
