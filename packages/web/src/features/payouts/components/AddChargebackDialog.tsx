import { useEffect, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import {
  MAX_STATEMENT_ADJUSTMENT_NOTE_LENGTH,
  normalizeStatementText,
  PAYOUT_NO_CARRIER,
  type PayStatementView,
} from "@sfa/shared";
import { FormError, FormGrid } from "@/components/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppForm } from "@/hooks/form";
import { formatMonth } from "@/lib/months";
import { addPayStatementAdjustment } from "@/lib/payouts-api";
import { payoutErrorMessage } from "../payout-errors";
import { moneyString } from "../payout-form-fields";
import { useApplyStatement } from "../statement-cache";

/** The API's own limits on a manual chargeback line. */
const MAX_POLICY_NUMBER_LENGTH = 60;
const MAX_CUSTOMER_NAME_LENGTH = 120;

const addChargebackSchema = z.object({
  policyNumber: z
    .string()
    .trim()
    .min(1, "Enter the policy number.")
    .max(
      MAX_POLICY_NUMBER_LENGTH,
      `At most ${MAX_POLICY_NUMBER_LENGTH} characters`,
    ),
  // Starts undefined, so the picker shows its placeholder rather than a blank.
  carrier: z
    .string()
    .optional()
    .refine((value) => Boolean(value), "Choose the carrier."),
  amount: moneyString("Enter the amount charged back").refine(
    (value) => Number(value) > 0,
    "Must be more than $0",
  ),
  customerName: z
    .string()
    .trim()
    .max(
      MAX_CUSTOMER_NAME_LENGTH,
      `At most ${MAX_CUSTOMER_NAME_LENGTH} characters`,
    ),
  note: z
    .string()
    .trim()
    .min(1, "Say why it is added.")
    .max(
      MAX_STATEMENT_ADJUSTMENT_NOTE_LENGTH,
      `At most ${MAX_STATEMENT_ADJUSTMENT_NOTE_LENGTH} characters`,
    ),
});

type AddChargebackValues = z.input<typeof addChargebackSchema>;

/**
 * Charge the employee a chargeback the ledger does not hold (PAC-182) — one
 * the carrier report missed, say. The API writes it to the ledger as a
 * manual row in the statement's month and recalculates; it comes off the
 * premium line of its carrier.
 *
 * The carrier is one of the statement's lines, since it picks the rate; a
 * policy the app holds is found by its number and its own carrier wins
 * (one held without a carrier takes the one chosen here). A policy is
 * charged back once: a 409 `PAYOUT_CHARGEBACK_ALREADY_CHARGED` says so
 * inline — and to whom and when only if that is this employee. A reviewer's,
 * on a draft or disputed statement; Remove on the row deletes it again.
 */
export function AddChargebackDialog({
  statement,
  open,
  onOpenChange,
}: {
  statement: PayStatementView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const carriers = useMemo(
    () => [
      ...new Set(
        statement.premiumLines
          .map((line) => line.carrier)
          .filter((carrier) => carrier !== PAYOUT_NO_CARRIER),
      ),
    ],
    [statement.premiumLines],
  );
  // One carrier on the statement is the only choice: pick it.
  const onlyCarrier = carriers.length === 1 ? carriers[0] : undefined;
  const empty = useMemo<AddChargebackValues>(
    () => ({
      policyNumber: "",
      carrier: onlyCarrier,
      amount: "",
      customerName: "",
      note: "",
    }),
    [onlyCarrier],
  );

  const apply = useApplyStatement();
  const add = useMutation({
    mutationFn: (values: AddChargebackValues) =>
      addPayStatementAdjustment(statement.id, {
        kind: "add_chargeback",
        policyNumber: values.policyNumber.trim(),
        carrier: values.carrier ?? "",
        amount: Number(values.amount),
        customerName: values.customerName.trim() || null,
        note: normalizeStatementText(values.note),
      }),
    onSuccess: async (updated) => {
      await apply(updated);
      onOpenChange(false);
      toast.success("Chargeback added and the statement recalculated.");
    },
  });

  const form = useAppForm({
    defaultValues: empty,
    // On change, not blur: several fields under one form-level schema, so a
    // blur fills in every field's error and one being typed into would show
    // a stale one until the next blur.
    validators: {
      onChange: addChargebackSchema,
      onSubmit: addChargebackSchema,
    },
    onSubmit: ({ value }) => add.mutate(value),
  });

  // Clear on open, so a cancelled line never resurfaces. `form` and `add`
  // are stable instances.
  useEffect(() => {
    if (open) {
      form.reset(empty);
      add.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pending = add.isPending;
  const firstName = statement.userName.split(" ")[0];
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a chargeback</DialogTitle>
          <DialogDescription>
            Charge {firstName} for a policy the chargeback ledger does not hold
            yet. It counts in {formatMonth(statement.month)} and comes off its
            carrier&apos;s premium. A policy is charged back once.
          </DialogDescription>
        </DialogHeader>

        <form.AppForm>
          <form
            noValidate
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <FormGrid gap={3}>
              <form.AppField name="policyNumber">
                {(f) => (
                  <f.TextField
                    label="Policy number"
                    autoComplete="off"
                    disabled={pending}
                  />
                )}
              </form.AppField>
              <form.AppField name="carrier">
                {(f) => (
                  <f.SelectField
                    label="Carrier"
                    options={carriers}
                    placeholder={
                      carriers.length === 0
                        ? "No carriers on this statement"
                        : "Choose a carrier"
                    }
                    description="If the app holds this policy, its own carrier is used."
                    triggerClassName="w-full"
                    disabled={pending || carriers.length === 0}
                  />
                )}
              </form.AppField>
              <form.AppField name="amount">
                {(f) => (
                  <f.MoneyField
                    label="Amount charged back"
                    description="Premium, as a positive amount."
                    disabled={pending}
                  />
                )}
              </form.AppField>
              <form.AppField name="customerName">
                {(f) => (
                  <f.TextField
                    label="Customer name (optional)"
                    autoComplete="off"
                    disabled={pending}
                  />
                )}
              </form.AppField>
              <form.AppField name="note">
                {(f) => (
                  <f.TextareaField
                    label="Why"
                    rows={3}
                    maxLength={MAX_STATEMENT_ADJUSTMENT_NOTE_LENGTH}
                    placeholder="Missing from the carrier report, …"
                    description={`${firstName} sees this note on the statement.`}
                    className="sm:col-span-2"
                    disabled={pending}
                  />
                )}
              </form.AppField>
            </FormGrid>

            <FormError>
              {add.isError ? payoutErrorMessage(add.error) : null}
            </FormError>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 aria-hidden className="animate-spin" />}
                Add chargeback
              </Button>
            </DialogFooter>
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
