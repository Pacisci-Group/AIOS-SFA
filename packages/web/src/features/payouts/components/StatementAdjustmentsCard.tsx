import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import {
  enteredAdjustmentsOf,
  isEditableStatementStatus,
  ModuleKey,
  type PayStatementView,
  type StatementEnteredAdjustments,
} from "@sfa/shared";
import { DataRow, DetailCard } from "@/components/common/DetailCard";
import { FormGrid } from "@/components/form";
import { Button } from "@/components/ui/button";
import { useAppForm } from "@/hooks/form";
import { usePermissions } from "@/hooks/usePermissions";
import { formatMoney } from "@/lib/money";
import {
  payoutRunsKey,
  payStatementKey,
  payStatementListsKey,
  updatePayStatementAdjustments,
} from "@/lib/payouts-api";
import { useOwnStatementBlocked } from "../own-statement";
import { payoutErrorMessage } from "../payout-errors";
import {
  blankNumber,
  blankOr,
  moneyString,
  toField,
} from "../payout-form-fields";

/**
 * The amounts a reviewer works out outside the app and types onto a
 * statement (owner, 10 Nov 2026): Other bonuses / SPIFFs, **added**, and the
 * compliance adjustment and other adjustments, **deducted**. Each is entered
 * as a positive amount; the summary shows the deductions as negatives.
 *
 * Editable with `payouts:write` on a draft or disputed statement — not on
 * one's own without `agency:payouts:admin` (the API refuses it with
 * `PAYOUT_STATEMENT_OWN_STATEMENT`). Everyone else sees them read-only.
 * Saving recalculates the statement; a month's recalculation keeps them.
 */
export function StatementAdjustmentsCard({
  statement,
}: {
  statement: PayStatementView;
}) {
  const { canWrite } = usePermissions();
  const ownBlocked = useOwnStatementBlocked(statement);
  /** Bumped after a save to re-seed the form from what the server stored. */
  const [seed, setSeed] = useState(0);

  const entered = enteredAdjustmentsOf(statement.adjustments);
  const reviewer = canWrite(ModuleKey.Payouts);
  const editable =
    reviewer && isEditableStatementStatus(statement.status) && !ownBlocked;
  // An employee sees the summary's lines; the card is the reviewer's.
  if (!reviewer) return null;
  const note = editable
    ? "Worked out outside the app. Enter each as a positive amount: bonuses are added, adjustments deducted. Saving recalculates the statement."
    : ownBlocked
      ? "Someone else enters the adjustments on your own statement."
      : "This statement has been sent, so its adjustments can no longer change.";

  return (
    <DetailCard
      title="Bonuses and adjustments"
      subheading={<p className="pt-1 text-sm text-muted-foreground">{note}</p>}
    >
      {editable ? (
        <AdjustmentsForm
          key={seed}
          statementId={statement.id}
          initial={entered}
          onSaved={() => setSeed((previous) => previous + 1)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <DataRow
            label="Other bonuses / SPIFFs"
            value={amountOrNone(entered.spiffs, 1)}
          />
          <DataRow
            label="Compliance adjustment"
            value={amountOrNone(entered.complianceAdjustment, -1)}
          />
          <DataRow
            label="Other adjustments"
            value={amountOrNone(entered.otherAdjustments, -1)}
          />
        </div>
      )}
    </DetailCard>
  );
}

function amountOrNone(value: number | null, sign: 1 | -1): string {
  return value === null ? "None" : formatMoney(sign * value);
}

const amountField = blankOr(moneyString("Enter an amount"));

const adjustmentsFormSchema = z.object({
  spiffs: amountField,
  complianceAdjustment: amountField,
  otherAdjustments: amountField,
});

type AdjustmentsFormValues = z.infer<typeof adjustmentsFormSchema>;

function adjustmentsOf(
  values: AdjustmentsFormValues,
): StatementEnteredAdjustments {
  return {
    spiffs: blankNumber(values.spiffs),
    complianceAdjustment: blankNumber(values.complianceAdjustment),
    otherAdjustments: blankNumber(values.otherAdjustments),
  };
}

function AdjustmentsForm({
  statementId,
  initial,
  onSaved,
}: {
  statementId: string;
  initial: StatementEnteredAdjustments;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [defaultValues] = useState<AdjustmentsFormValues>(() => ({
    spiffs: toField(initial.spiffs),
    complianceAdjustment: toField(initial.complianceAdjustment),
    otherAdjustments: toField(initial.otherAdjustments),
  }));

  const save = useMutation({
    mutationFn: (input: StatementEnteredAdjustments) =>
      updatePayStatementAdjustments(statementId, input),
    onSuccess: async (updated) => {
      queryClient.setQueryData(payStatementKey(statementId), updated);
      onSaved();
      toast.success("Adjustments saved and the statement recalculated.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: payStatementListsKey }),
        queryClient.invalidateQueries({ queryKey: payoutRunsKey }),
      ]);
    },
    onError: (error) => toast.error(payoutErrorMessage(error)),
  });

  const form = useAppForm({
    defaultValues,
    validators: { onBlur: adjustmentsFormSchema },
    onSubmit: ({ value }) => save.mutate(adjustmentsOf(value)),
  });

  return (
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
          <form.AppField name="spiffs">
            {(f) => (
              <f.MoneyField
                label="Other bonuses / SPIFFs"
                description="Added to pay."
                placeholder="None"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="complianceAdjustment">
            {(f) => (
              <f.MoneyField
                label="Compliance adjustment"
                description="Deducted from pay."
                placeholder="None"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="otherAdjustments">
            {(f) => (
              <f.MoneyField
                label="Other adjustments"
                description="Deducted from pay."
                placeholder="None"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
        </FormGrid>
        <form.Subscribe selector={(state) => state.isDirty}>
          {(dirty) => (
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={!dirty || save.isPending}
            >
              {save.isPending ? "Saving…" : "Save adjustments"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </form.AppForm>
  );
}
