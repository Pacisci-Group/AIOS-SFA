import type {
  CancelPolicyInput,
  HouseholdView,
  PolicySummary,
  PolicyView,
} from "@sfa/shared";
import {
  POLICY_CANCELLATION_NOTE_MAX,
  POLICY_CANCELLATION_REASONS,
  POLICY_CANCELLATION_REASON_LABELS,
} from "@sfa/shared";
import { useStore } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAppForm } from "@/hooks/form";
import { getStoredUser } from "@/lib/api-client";
import { agencyTodayYmd } from "@/lib/dates";
import { cancelHouseholdPolicy } from "@/lib/policies-api";
import { householdDetailKey } from "./useUpdateHouseholdPolicy";

/**
 * `""` until a reason is picked, so the select opens on its placeholder rather
 * than on a reason nobody chose — defaulting to "Sold" would record the most
 * common answer for every rep who did not read the field.
 *
 * The carrier's date is asked for only with a chargeback (PAC-173 PR 6), and
 * bounded by the agency's today — the API refuses a later one, and one before
 * the sale.
 */
function makeCancelSchema(today: string) {
  return z
    .object({
      reason: z
        .union([z.enum(POLICY_CANCELLATION_REASONS), z.literal("")])
        .refine((value) => value !== "", "Pick a reason"),
      note: z
        .string()
        .trim()
        .max(POLICY_CANCELLATION_NOTE_MAX, "Keep it under 500 characters"),
      chargeback: z.boolean(),
      cancelledOn: z.string(),
    })
    .refine((value) => value.reason !== "other" || value.note.trim() !== "", {
      message: "Say why the policy was cancelled",
      path: ["note"],
    })
    .refine(
      (value) =>
        !value.chargeback || /^\d{4}-\d{2}-\d{2}$/.test(value.cancelledOn),
      {
        message: "Enter the date the carrier cancelled it",
        path: ["cancelledOn"],
      },
    )
    .refine((value) => !value.chargeback || value.cancelledOn <= today, {
      message: "The cancellation date can't be in the future",
      path: ["cancelledOn"],
    });
}

// The *input* type: the refine above narrows the output's `reason` past `""`,
// and the form holds what the user has picked so far, not what validated.
type CancelFormValues = z.input<ReturnType<typeof makeCancelSchema>>;

const emptyValues = (chargeback: boolean): CancelFormValues => ({
  reason: "",
  note: "",
  chargeback,
  cancelledOn: "",
});

const REASON_OPTIONS = POLICY_CANCELLATION_REASONS.map((reason) => ({
  value: reason,
  label: POLICY_CANCELLATION_REASON_LABELS[reason],
}));

/** What the dialog says about the policy — all a Dash row knows of it too. */
type CancelPolicyTarget = Pick<
  PolicySummary,
  "id" | "policyNumber" | "policyType" | "carrier"
>;

interface CancelPolicyDialogProps {
  householdId: string;
  policy: CancelPolicyTarget;
  /**
   * Runs once the cancellation is saved — the page opens the "update the
   * address?" prompt from here.
   *
   * A callback rather than a prompt rendered in this component, because this
   * component does not survive the save: on the household page the cancelled
   * policy moves into the collapsed section and its card unmounts, and on the
   * policy page the actions row is only shown for a live policy. A follow-up
   * owned by either would vanish the moment it opened.
   */
  onCancelled?: (saved: PolicySummary) => void;
  /**
   * The **Record a chargeback** box (PAC-173 PR 6). `optional` — the household
   * page — offers it unticked; `required` — a Dash row's Chargeback outcome,
   * whose whole point is the chargeback — ticks and locks it.
   */
  chargeback?: "optional" | "required";
  /**
   * Where the cancel goes; the household's cancel endpoint unless given. A
   * Dash row sends it to the row (`cancelReconciliationPolicy`), which
   * finishes the outcome in the same transaction, and answers with the policy
   * as this dialog's cache writes expect.
   */
  submit?: (input: CancelPolicyInput) => Promise<PolicySummary>;
  /** The button that opens it; the policy card's "Cancel policy" unless given. */
  trigger?: ReactNode;
}

/**
 * The household policy card's **Cancel** button — cancel a policy and say why.
 *
 * Replaces setting the Edit dialog's status to Cancelled, which recorded that
 * the client left and never why. The reasons are a short vocabulary (Sold,
 * Changed carrier) plus Other, which asks for the reason in words. `Cancelled`
 * is no longer offered in the Edit dialog at all: it is a flow-only status, and
 * this is the flow.
 *
 * The caller owns the gate (`clients:write` or `crm_service:write`, matching the
 * endpoint) and the check that the policy is still live — see
 * `HouseholdPolicyActions`.
 *
 * **Record a chargeback** (PAC-173 PR 6) charges the premium back to the
 * producer who sold it, dated on the carrier's cancellation date — inside a
 * calendar month of the sale their sold credit is reversed too. Unticked, the
 * cancel is exactly what it was: no date asked, nothing charged back.
 */
export function CancelPolicyDialog({
  householdId,
  policy,
  onCancelled,
  chargeback: chargebackMode = "optional",
  submit,
  trigger,
}: CancelPolicyDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const chargebackRequired = chargebackMode === "required";
  // Re-read on every open: a page left open overnight must offer today.
  const [today, setToday] = useState(() =>
    agencyTodayYmd(getStoredUser()?.timeZone),
  );
  const cancelSchema = useMemo(() => makeCancelSchema(today), [today]);

  const mutation = useMutation({
    mutationFn: (input: CancelPolicyInput) =>
      submit
        ? submit(input)
        : cancelHouseholdPolicy(householdId, policy.id, input),
    onSuccess: (saved) => {
      setOpen(false);
      // Before the cache write below, which is what unmounts this component.
      onCancelled?.(saved);

      // The household page has no policies query of its own — they arrive
      // nested on the household — so the saved row is spliced into it, the same
      // as `useUpdateHouseholdPolicy` does for an edit.
      queryClient.setQueryData<HouseholdView>(
        householdDetailKey(householdId),
        (current) => {
          if (!current) return current;
          const policies = current.policies.map((row) =>
            row.id === saved.id ? saved : row,
          );
          return {
            ...current,
            policies,
            totalActivePolicies: policies.filter((row) => row.active).length,
          };
        },
      );
      // The policy page reads `PolicyView`, a superset — merge rather than replace.
      queryClient.setQueryData<PolicyView>(["policy", saved.id], (current) =>
        current ? { ...current, ...saved } : current,
      );
      void queryClient.invalidateQueries({ queryKey: ["policy-history", saved.id] });
      // The Clients list sorts on the active count the server just recounted.
      void queryClient.invalidateQueries({ queryKey: ["households"] });
      void queryClient.invalidateQueries({ queryKey: ["unlinked-counts"] });
      void queryClient.invalidateQueries({ queryKey: ["unlinked"] });
      toast.success(
        saved.cancellation?.chargebackId
          ? "Policy cancelled — chargeback recorded"
          : "Policy cancelled",
      );
    },
    onError: (error: Error) => {
      toast.error(error.message || "Couldn't cancel the policy");
    },
  });

  const form = useAppForm({
    defaultValues: emptyValues(chargebackRequired),
    validators: { onBlur: cancelSchema },
    onSubmit: ({ value }) => {
      if (!value.reason) return;
      const withChargeback = chargebackRequired || value.chargeback;
      mutation.mutate({
        reason: value.reason,
        // Sent only with Other; the server drops it for the named reasons.
        note: value.reason === "other" ? value.note.trim() : null,
        chargeback: withChargeback ? { cancelledOn: value.cancelledOn } : null,
      });
    },
  });

  // Cleared on open so a reason picked and abandoned never resurfaces.
  // `form` is a stable instance, so it does not need to be a dependency.
  useEffect(() => {
    if (open) {
      setToday(agencyTodayYmd(getStoredUser()?.timeZone));
      form.reset(emptyValues(chargebackRequired));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const reason = useStore(form.store, (s) => s.values.reason);
  const withChargeback = useStore(form.store, (s) => s.values.chargeback);

  const label = [policy.policyType ?? "Policy", policy.policyNumber]
    .filter(Boolean)
    .join(" ");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Ban aria-hidden className="size-4" />
            Cancel policy
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel policy</DialogTitle>
          <DialogDescription>
            {label}
            {policy.carrier ? ` with ${policy.carrier}` : ""} comes off the
            household&apos;s active lines. Say why it was cancelled.
          </DialogDescription>
        </DialogHeader>

        <form.AppForm>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
            className="space-y-4"
            noValidate
          >
            <form.AppField name="reason">
              {(f) => (
                <f.SelectField
                  label="Reason"
                  options={REASON_OPTIONS}
                  placeholder="Pick a reason"
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>

            {reason === "other" && (
              <form.AppField name="note">
                {(f) => (
                  <f.TextareaField
                    label="What happened?"
                    rows={3}
                    placeholder="e.g. Moved out of state"
                    textareaClassName="bg-card border-border"
                  />
                )}
              </form.AppField>
            )}

            <form.AppField name="chargeback">
              {(f) => (
                <f.CheckboxField
                  label="Record a chargeback"
                  hint="The premium is charged back to the producer who sold it. Inside a month of the sale, their sold credit is reversed too."
                  disabled={chargebackRequired}
                />
              )}
            </form.AppField>

            {withChargeback && (
              <form.AppField name="cancelledOn">
                {(f) => (
                  <f.TextField
                    label="Carrier's cancellation date"
                    description="From the carrier's notice. It decides whether the cancellation falls inside the month."
                    type="date"
                    max={today}
                    inputClassName="bg-card border-border sm:max-w-xs"
                  />
                )}
              </form.AppField>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={mutation.isPending}
              >
                Keep policy
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                Cancel policy
              </Button>
            </DialogFooter>
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
