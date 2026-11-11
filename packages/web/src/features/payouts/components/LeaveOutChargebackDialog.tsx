import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import {
  MAX_STATEMENT_ADJUSTMENT_NOTE_LENGTH,
  normalizeStatementText,
  type StatementChargebackView,
} from "@sfa/shared";
import { FormError } from "@/components/form";
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
import { formatMoney } from "@/lib/money";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { addPayStatementAdjustment } from "@/lib/payouts-api";
import { payoutErrorMessage } from "../payout-errors";
import { useApplyStatement } from "../statement-cache";

const leaveOutSchema = z.object({
  note: z
    .string()
    .trim()
    .min(1, "Say why it is left out.")
    .max(
      MAX_STATEMENT_ADJUSTMENT_NOTE_LENGTH,
      `At most ${MAX_STATEMENT_ADJUSTMENT_NOTE_LENGTH} characters`,
    ),
});

type LeaveOutValues = z.infer<typeof leaveOutSchema>;

const EMPTY_LEAVE_OUT: LeaveOutValues = { note: "" };

/**
 * Leave one chargeback on a statement out of it (PAC-182), with why. The row
 * stays in the ledger and on the statement, struck through with the note,
 * and stops coming off the pay; Restore undoes it. A reviewer's, on a draft
 * or disputed statement.
 */
export function LeaveOutChargebackDialog({
  statementId,
  employeeName,
  row,
  onClose,
}: {
  statementId: string;
  /** Whose statement it is, for the note's hint. */
  employeeName: string;
  /** The chargeback being left out; `null` closes the dialog. */
  row: StatementChargebackView | null;
  onClose: () => void;
}) {
  // The row the dialog last showed, kept while it animates closed.
  const [shown, setShown] = useState(row);
  if (row !== null && row !== shown) setShown(row);
  const current = row ?? shown;

  const apply = useApplyStatement();
  const leaveOut = useMutation({
    mutationFn: (input: { chargebackId: string; note: string }) =>
      addPayStatementAdjustment(statementId, {
        kind: "exclude_chargeback",
        ...input,
      }),
    onSuccess: async (updated) => {
      await apply(updated);
      onClose();
      toast.success("Chargeback left out and the statement recalculated.");
    },
  });

  const form = useAppForm({
    defaultValues: EMPTY_LEAVE_OUT,
    validators: { onBlur: leaveOutSchema },
    onSubmit: ({ value }) => {
      if (!current) return;
      leaveOut.mutate({
        chargebackId: current.chargebackId,
        note: normalizeStatementText(value.note),
      });
    },
  });

  // Clear for each row, so one row's note never lands on the next. `form`
  // and `leaveOut` are stable instances.
  const openFor = row?.chargebackId ?? null;
  useEffect(() => {
    if (openFor) {
      form.reset(EMPTY_LEAVE_OUT);
      leaveOut.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFor]);

  const pending = leaveOut.isPending;
  return (
    <Dialog
      open={row !== null}
      onOpenChange={(next) => !next && !pending && onClose()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Leave this chargeback out?</DialogTitle>
          <DialogDescription>
            It stays on the statement, struck through with your note, and no
            longer comes off the pay. Restore puts it back.
          </DialogDescription>
        </DialogHeader>

        {current && (
          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border px-4 py-3 text-sm sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="font-medium break-words">
                {current.customerName ?? NOT_AVAILABLE}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Policy</dt>
              <dd className="font-medium break-words tabular-nums">
                {current.policyNumber ?? NOT_AVAILABLE}
              </dd>
            </div>
            <div className="min-w-0 sm:text-right">
              <dt className="text-xs text-muted-foreground">Amount</dt>
              <dd className="font-medium tabular-nums">
                {formatMoney(current.amount)}
              </dd>
            </div>
          </dl>
        )}

        <form.AppForm>
          <form
            noValidate
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.AppField name="note">
              {(f) => (
                <f.TextareaField
                  label="Why"
                  rows={3}
                  maxLength={MAX_STATEMENT_ADJUSTMENT_NOTE_LENGTH}
                  placeholder="Not theirs, reversed by the carrier, charged in another month…"
                  description={`${employeeName.split(" ")[0]} sees this note on the statement.`}
                  disabled={pending}
                />
              )}
            </form.AppField>

            <FormError>
              {leaveOut.isError ? payoutErrorMessage(leaveOut.error) : null}
            </FormError>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 aria-hidden className="animate-spin" />}
                Leave it out
              </Button>
            </DialogFooter>
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
