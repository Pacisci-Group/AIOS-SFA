import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { defaultStartingBalance, type HrPolicySummary, type PersonProfileView } from "@sfa/shared";
import { FormError } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api-client";
import { hrKeys, listHrPolicies } from "@/lib/hr-api";
import { enrolMember, peopleKeys } from "@/lib/people-api";
import { cn } from "@/lib/utils";
import { formatBalance, summarizeTimeOff, timeOffKindLabel } from "@/features/hr/policies/time-off/time-off-display";
import { PersonSheet } from "./PersonSheet";
import { currentOfKind, currentPolicyIds, policyKind } from "./policy-choices";

type TimeOffSummary = Extract<HrPolicySummary, { type: "time_off" }>;

/**
 * Add a person to a time off policy (PAC-162, `agency:hr:admin`): the
 * active time off policies they are not in, one picked, a starting
 * balance on a fixed-amount policy (blank = the policy's default), and the
 * "moves from" line when they are in another policy of that kind. Holiday
 * and Work week membership is changed from the policies page; the profile
 * only shows those.
 */
export function AddToPolicySheet({
  profile,
  onClose,
}: {
  profile: PersonProfileView;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  const [balance, setBalance] = useState("");
  const [error, setError] = useState<string | null>(null);

  const policies = useQuery({
    queryKey: hrKeys.policies("time_off"),
    queryFn: () => listHrPolicies("time_off"),
  });
  const mine = currentPolicyIds(profile);
  const options = (policies.data?.policies ?? []).filter(
    (policy): policy is TimeOffSummary => policy.type === "time_off" && !mine.has(policy.id),
  );
  const chosen = options.find((policy) => policy.id === picked) ?? null;
  const movesFrom = chosen
    ? currentOfKind(profile, policies.data?.policies ?? [], policyKind(chosen))
    : null;
  const fallback = chosen ? defaultStartingBalance(chosen.timeOff) : null;

  const add = useMutation({
    mutationFn: () =>
      enrolMember(chosen!.id, {
        userId: profile.user.id,
        ...(balance.trim() !== "" ? { startingBalanceHours: Number(balance) } : {}),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: peopleKeys.profile(profile.user.id) }),
        queryClient.invalidateQueries({ queryKey: hrKeys.all }),
      ]);
      toast.success(`Added to ${chosen?.name}.`);
      onClose();
    },
    onError: (failure) =>
      setError(failure instanceof ApiError ? failure.message : "Could not add them. Try again."),
  });

  const balanceInvalid =
    balance.trim() !== "" && (Number.isNaN(Number(balance)) || Number(balance) < 0);

  return (
    <PersonSheet eyebrow={profile.user.name} title="Add to a time off policy" onClose={onClose}>
      <form
        className="flex flex-1 flex-col gap-5 px-6 py-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!chosen || balanceInvalid) return;
          setError(null);
          add.mutate();
        }}
      >
        {policies.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : options.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {policies.data?.policies.length
              ? "They are already in every active time off policy."
              : "There are no time off policies yet. Create one under Workspace Settings → HR policies."}
          </p>
        ) : (
          <div role="radiogroup" aria-label="Time off policy" className="space-y-2">
            {options.map((policy) => {
              const on = policy.id === picked;
              return (
                <button
                  key={policy.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setPicked(policy.id);
                    setBalance("");
                  }}
                  className={cn(
                    "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                    on
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-muted/50",
                  )}
                >
                  <p className="text-sm font-medium text-foreground">{policy.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {timeOffKindLabel(policy.timeOff)} · {summarizeTimeOff(policy.timeOff)}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {chosen && (
          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            {movesFrom && (
              <p className="text-sm text-muted-foreground">
                Moves them out of <span className="font-medium text-foreground">{movesFrom.name}</span>{" "}
                — one {timeOffKindLabel(chosen.timeOff)} policy per person. Their balance there stays
                on record.
              </p>
            )}
            {fallback !== null && (
              <div className="space-y-1.5 sm:max-w-xs">
                <Label htmlFor="add-policy-balance" className="text-xs text-muted-foreground">
                  Starting balance (hours)
                </Label>
                <Input
                  id="add-policy-balance"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.25"
                  placeholder={formatBalance(fallback)}
                  value={balance}
                  onChange={(event) => setBalance(event.target.value)}
                  aria-invalid={balanceInvalid}
                />
                <p className="text-xs text-muted-foreground">
                  Blank means the policy's default, {formatBalance(fallback)}. Someone who was in
                  this policy before resumes the balance they had instead.
                </p>
              </div>
            )}
            {fallback === null && (
              <p className="text-sm text-muted-foreground">Unlimited — no balance to set.</p>
            )}
          </div>
        )}

        <FormError>{error}</FormError>

        <div className="mt-auto flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="brand"
            disabled={!chosen || balanceInvalid || add.isPending}
          >
            {add.isPending ? "Adding…" : "Add to policy"}
          </Button>
        </div>
      </form>
    </PersonSheet>
  );
}
