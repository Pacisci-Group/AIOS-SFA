import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import {
  MAX_STATEMENT_TYPED_NAME_LENGTH,
  STATEMENT_ACKNOWLEDGMENT_TEXT,
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
import { useAuth } from "@/contexts/auth-context";
import { useAppForm } from "@/hooks/form";
import { formatMonth } from "@/lib/months";
import { acceptPayStatement } from "@/lib/payouts-api";
import { payoutErrorMessage } from "../payout-errors";
import { useApplyStatement } from "../statement-cache";

const acceptSchema = z.object({
  acknowledged: z.literal(true, {
    message: "Tick the box to acknowledge the statement.",
  }),
  typedName: z
    .string()
    .trim()
    .min(1, "Type your full name to sign.")
    .max(
      MAX_STATEMENT_TYPED_NAME_LENGTH,
      `At most ${MAX_STATEMENT_TYPED_NAME_LENGTH} characters`,
    ),
});

interface AcceptValues {
  acknowledged: boolean;
  typedName: string;
}

const EMPTY_ACCEPT: AcceptValues = { acknowledged: false, typedName: "" };

/**
 * The employee accepts their sent statement (PAC-182): they tick the
 * acknowledgment the PDF prints — the same sentence, from `@sfa/shared` — and
 * type their name as their signature. Final: the API stores a signed copy of
 * the PDF, which the PDF tab then shows.
 *
 * Only for the statement's own employee; the page offers it only to them,
 * and the API refuses anyone else (`PAYOUT_STATEMENT_NOT_YOURS`).
 */
export function AcceptStatementDialog({
  statement,
  open,
  onOpenChange,
}: {
  statement: PayStatementView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const apply = useApplyStatement();
  const accept = useMutation({
    mutationFn: (typedName: string) =>
      acceptPayStatement(statement.id, { typedName, acknowledged: true }),
    onSuccess: async (updated) => {
      await apply(updated);
      onOpenChange(false);
      toast.success("Statement accepted. The signed copy is on the PDF tab.");
    },
  });

  const form = useAppForm({
    defaultValues: EMPTY_ACCEPT,
    // On change, not blur: several fields under one form-level schema, so a
    // blur fills in every field's error and one being typed into would show
    // a stale one until the next blur.
    validators: { onChange: acceptSchema, onSubmit: acceptSchema },
    // One line, as the API stores it.
    onSubmit: ({ value }) =>
      accept.mutate(value.typedName.replace(/\s+/g, " ").trim()),
  });

  // Clear on open, so an abandoned signature never resurfaces. `form` and
  // `accept` are stable instances.
  useEffect(() => {
    if (open) {
      form.reset(EMPTY_ACCEPT);
      accept.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pending = accept.isPending;
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Accept your statement</DialogTitle>
          <DialogDescription>
            Your commission statement for {formatMonth(statement.month)},
            version {statement.version}.
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
            <form.AppField name="acknowledged">
              {(f) => (
                <f.CheckboxField
                  label={STATEMENT_ACKNOWLEDGMENT_TEXT}
                  disabled={pending}
                />
              )}
            </form.AppField>
            <form.AppField name="typedName">
              {(f) => (
                <f.TextField
                  label="Type your full name to sign"
                  placeholder={user?.name ?? undefined}
                  autoComplete="name"
                  disabled={pending}
                />
              )}
            </form.AppField>
            <p className="text-sm text-muted-foreground">
              Accepting is final: the statement can no longer change. A signed
              copy is stored on the PDF tab.
            </p>

            <FormError>
              {accept.isError ? payoutErrorMessage(accept.error) : null}
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
                Accept and sign
              </Button>
            </DialogFooter>
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
