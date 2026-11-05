import { useState } from "react";
import { useStore } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import {
  BALANCE_ADJUSTMENT_REASON_MAX_LENGTH,
  TIME_OFF_HOURS_MAX,
  type PersonProfileView,
  type PersonTimeOffPolicyView,
} from "@sfa/shared";
import { FormError } from "@/components/form";
import { Button } from "@/components/ui/button";
import { formatBalance } from "@/features/hr/policies/time-off/time-off-display";
import { useAppForm } from "@/hooks/form";
import { ApiError } from "@/lib/api-client";
import { hrKeys } from "@/lib/hr-api";
import { peopleKeys } from "@/lib/people-api";
import { adjustTimeOffBalance, timeOffKeys } from "@/lib/time-off-api";
import { PersonSheet } from "./PersonSheet";

const schema = z.object({
  direction: z.enum(["add", "remove"]),
  hours: z
    .string()
    .trim()
    .refine((value) => {
      const hours = Number(value);
      return value !== "" && Number.isFinite(hours) && hours > 0 && hours <= TIME_OFF_HOURS_MAX;
    }, "Enter the hours to add or remove."),
  reason: z
    .string()
    .trim()
    .min(1, "Say why the balance is being adjusted.")
    .max(
      BALANCE_ADJUSTMENT_REASON_MAX_LENGTH,
      `Keep it under ${BALANCE_ADJUSTMENT_REASON_MAX_LENGTH} characters.`,
    ),
});

/**
 * Adjust a person's balance in one policy by hand (PAC-165,
 * `agency:hr:admin`): add or remove hours, with the reason. It posts a row
 * to the leave ledger — the balance is never edited, only added to — so the
 * reason is the explanation that row will always carry, and a mistake is
 * corrected with another adjustment. The employee is told.
 *
 * Also the tool for what the request flow refuses on purpose: leave in a
 * period that has already been reset.
 */
export function AdjustBalanceSheet({
  profile,
  policy,
  onClose,
}: {
  profile: PersonProfileView;
  policy: PersonTimeOffPolicyView;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (values: z.infer<typeof schema>) =>
      adjustTimeOffBalance(profile.user.id, {
        policyId: policy.id,
        hours: (values.direction === "remove" ? -1 : 1) * Number(values.hours),
        reason: values.reason.trim(),
      }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: peopleKeys.profile(profile.user.id) }),
        queryClient.invalidateQueries({ queryKey: hrKeys.all }),
        queryClient.invalidateQueries({ queryKey: timeOffKeys.all }),
      ]);
      toast.success(`Balance is now ${formatBalance(result.balanceHours)}.`);
      onClose();
    },
    onError: (failure) =>
      setError(failure instanceof ApiError ? failure.message : "Could not save. Try again."),
  });

  const form = useAppForm({
    defaultValues: { direction: "add", hours: "", reason: "" } as z.infer<typeof schema>,
    validators: { onBlur: schema },
    onSubmit: ({ value }) => {
      setError(null);
      save.mutate(value);
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const typed = Number(values.hours);
  const change =
    values.hours.trim() !== "" && Number.isFinite(typed) && typed > 0
      ? (values.direction === "remove" ? -1 : 1) * typed
      : null;
  const current = policy.balanceHours ?? 0;

  return (
    <PersonSheet eyebrow={profile.user.name} title={`Adjust ${policy.name}`} onClose={onClose}>
      <form.AppForm>
        <form
          className="flex flex-1 flex-col gap-5 px-6 py-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.AppField name="direction">
            {(f) => (
              <f.RadioGroupField
                label="Adjustment"
                options={[
                  { value: "add", label: "Add hours", caption: "The balance goes up." },
                  { value: "remove", label: "Remove hours", caption: "The balance goes down." },
                ]}
              />
            )}
          </form.AppField>
          <form.AppField name="hours">
            {(f) => (
              <f.NumberField
                label="Hours"
                className="max-w-40"
                step="0.25"
                min="0"
                placeholder="8"
              />
            )}
          </form.AppField>
          <form.AppField name="reason">
            {(f) => (
              <f.TextareaField
                label="Reason"
                description="Kept with the adjustment and shown to the employee."
                rows={3}
              />
            )}
          </form.AppField>

          <dl className="grid gap-2 rounded-lg border border-border bg-sunken px-4 py-3 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Current balance</dt>
              <dd className="tabular-nums text-foreground">{formatBalance(current)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2">
              <dt className="font-medium text-foreground">After the adjustment</dt>
              <dd className="font-semibold tabular-nums text-foreground">
                {formatBalance(Math.round((current + (change ?? 0)) * 100) / 100)}
              </dd>
            </div>
          </dl>

          <FormError>{error}</FormError>

          <div className="mt-auto flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Adjust balance"}
            </Button>
          </div>
        </form>
      </form.AppForm>
    </PersonSheet>
  );
}
