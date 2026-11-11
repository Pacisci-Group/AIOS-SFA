import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import {
  MAX_STATEMENT_DISPUTE_NOTES_LENGTH,
  normalizeStatementText,
  type PayStatementView,
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
import { formatMonth } from "@/lib/months";
import { rejectPayStatement } from "@/lib/payouts-api";
import { payoutErrorMessage } from "../payout-errors";
import { useApplyStatement } from "../statement-cache";

const disputeSchema = z.object({
  notes: z
    .string()
    .trim()
    .min(1, "Say what is wrong with the statement.")
    .max(
      MAX_STATEMENT_DISPUTE_NOTES_LENGTH,
      `At most ${MAX_STATEMENT_DISPUTE_NOTES_LENGTH} characters`,
    ),
});

type DisputeValues = z.infer<typeof disputeSchema>;

const EMPTY_DISPUTE: DisputeValues = { notes: "" };

/**
 * The employee disputes their sent statement (PAC-182), saying what is wrong.
 * It goes back to the reviewers as Disputed: one corrects it and sends it
 * again as the next version, and the notes are printed on that version's PDF.
 *
 * Only for the statement's own employee, as accepting is.
 */
export function DisputeStatementDialog({
  statement,
  open,
  onOpenChange,
}: {
  statement: PayStatementView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const apply = useApplyStatement();
  const dispute = useMutation({
    mutationFn: (notes: string) => rejectPayStatement(statement.id, { notes }),
    onSuccess: async (updated) => {
      await apply(updated);
      onOpenChange(false);
      toast.success("Statement disputed. Your manager has been told.");
    },
  });

  const form = useAppForm({
    defaultValues: EMPTY_DISPUTE,
    validators: { onBlur: disputeSchema },
    onSubmit: ({ value }) =>
      dispute.mutate(normalizeStatementText(value.notes)),
  });

  // Clear on open, so abandoned notes never resurface. `form` and `dispute`
  // are stable instances.
  useEffect(() => {
    if (open) {
      form.reset(EMPTY_DISPUTE);
      dispute.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pending = dispute.isPending;
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dispute your statement</DialogTitle>
          <DialogDescription>
            Your commission statement for {formatMonth(statement.month)},
            version {statement.version}. Say what is wrong — a sale that is
            missing, a chargeback that is not yours, an amount that is off.
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
            <form.AppField name="notes">
              {(f) => (
                <f.TextareaField
                  label="What is wrong"
                  rows={6}
                  maxLength={MAX_STATEMENT_DISPUTE_NOTES_LENGTH}
                  placeholder="Which figures, and what you expected"
                  description="A reviewer will correct it and send it to you again."
                  disabled={pending}
                />
              )}
            </form.AppField>

            <FormError>
              {dispute.isError ? payoutErrorMessage(dispute.error) : null}
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
                Dispute statement
              </Button>
            </DialogFooter>
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
