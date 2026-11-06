import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import {
  AgencyPermission,
  EMPTY_STATEMENT_INPUTS,
  isEditableStatementStatus,
  ModuleKey,
  statementInputsError,
  type PayStatementView,
  type StatementInputs,
  type StatementInputsNeeded,
} from "@sfa/shared";
import { DataRow, DetailCard } from "@/components/common/DetailCard";
import { FormGrid } from "@/components/form";
import type { SelectOption } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { useAppForm } from "@/hooks/form";
import { usePermissions } from "@/hooks/usePermissions";
import { formatPercent } from "@/lib/money";
import {
  payoutRunsKey,
  payStatementKey,
  payStatementsKey,
  updatePayStatementInputs,
} from "@/lib/payouts-api";
import { payoutErrorMessage } from "../payout-errors";
import { blankNumber, toField } from "../payout-form-fields";
import { attendanceLabel } from "../payout-format";

/**
 * The figures the app cannot know (2026 comp plans) — the compliance rate,
 * month-end retention, valid life referrals, sales-meeting attendance —
 * entered by the manager on each draft. Only the ones the statement's
 * structure reads are asked for (`inputsNeeded`); the card is absent when it
 * reads none.
 *
 * Editable with `payouts:write` on a draft or disputed statement — but not
 * on one's own without `agency:payouts:admin`, since the figures decide
 * one's own pay (the API refuses it with `PAYOUT_STATEMENT_OWN_INPUTS`).
 * Everyone else sees them read-only. Saving recalculates the statement.
 */
export function StatementInputsCard({
  statement,
}: {
  statement: PayStatementView;
}) {
  const { user } = useAuth();
  const { can, canWrite } = usePermissions();
  /** Bumped after a save to re-seed the form from what the server stored. */
  const [seed, setSeed] = useState(0);
  const needed = statement.inputsNeeded;
  if (!needed || !Object.values(needed).some(Boolean)) return null;

  const inputs = statement.inputs ?? EMPTY_STATEMENT_INPUTS;
  const own = statement.userId === user?.id;
  const ownBlocked = own && !can(AgencyPermission.PayoutsAdmin);
  const editable =
    canWrite(ModuleKey.Payouts) &&
    isEditableStatementStatus(statement.status) &&
    !ownBlocked;
  const note = editable
    ? "Saving recalculates the statement. A minimum that needs a figure is not met until it is entered."
    : canWrite(ModuleKey.Payouts) && ownBlocked
      ? "Someone else enters the figures on your own statement."
      : canWrite(ModuleKey.Payouts) &&
          !isEditableStatementStatus(statement.status)
        ? "This statement has been sent, so its figures can no longer change."
        : "Entered by your manager.";

  return (
    <DetailCard
      title="Entered figures"
      subheading={<p className="pt-1 text-sm text-muted-foreground">{note}</p>}
    >
      {editable ? (
        <InputsForm
          key={seed}
          statementId={statement.id}
          initial={inputs}
          needed={needed}
          onSaved={() => setSeed((previous) => previous + 1)}
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {needed.compliance && (
            <DataRow
              label="Compliance rate"
              value={percentOrNotEntered(inputs.compliancePercent)}
            />
          )}
          {needed.retention && (
            <DataRow
              label="Retention"
              value={percentOrNotEntered(inputs.retentionPercent)}
            />
          )}
          {needed.referrals && (
            <DataRow
              label="Valid life referrals"
              value={
                inputs.lifeReferrals === null
                  ? "Not entered"
                  : String(inputs.lifeReferrals)
              }
            />
          )}
          {needed.attendance && (
            <DataRow
              label="Attended sales meetings"
              value={attendanceLabel(inputs.meetingAttendance)}
            />
          )}
        </div>
      )}
    </DetailCard>
  );
}

function percentOrNotEntered(value: number | null): string {
  return value === null ? "Not entered" : formatPercent(value);
}

/** Radix Select cannot hold `""`, so "not entered" needs a value of its own. */
const ATTENDANCE_VALUES = ["unset", "yes", "no"] as const;
type AttendanceValue = (typeof ATTENDANCE_VALUES)[number];

const ATTENDANCE_OPTIONS: readonly SelectOption<AttendanceValue>[] = [
  { value: "unset", label: "Not entered" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const inputsFormSchema = z
  .object({
    compliancePercent: z.string(),
    retentionPercent: z.string(),
    lifeReferrals: z.string(),
    meetingAttendance: z.enum(ATTENDANCE_VALUES),
  })
  .superRefine((values, ctx) => {
    // Each figure through the shared rules on its own, so a message lands on
    // the field it is about. Blank is "not entered", which is always fine.
    for (const key of [
      "compliancePercent",
      "retentionPercent",
      "lifeReferrals",
    ] as const) {
      const error = statementInputsError({
        ...EMPTY_STATEMENT_INPUTS,
        [key]: blankNumber(values[key]),
      });
      if (error) ctx.addIssue({ code: "custom", path: [key], message: error });
    }
  });

type InputsFormValues = z.infer<typeof inputsFormSchema>;

/** The figures as sent: all four, the ones not asked for unchanged. */
function inputsOf(values: InputsFormValues): StatementInputs {
  return {
    compliancePercent: blankNumber(values.compliancePercent),
    retentionPercent: blankNumber(values.retentionPercent),
    lifeReferrals: blankNumber(values.lifeReferrals),
    meetingAttendance:
      values.meetingAttendance === "unset"
        ? null
        : values.meetingAttendance === "yes",
  };
}

function InputsForm({
  statementId,
  initial,
  needed,
  onSaved,
}: {
  statementId: string;
  initial: StatementInputs;
  needed: StatementInputsNeeded;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [defaultValues] = useState<InputsFormValues>(() => ({
    compliancePercent: toField(initial.compliancePercent),
    retentionPercent: toField(initial.retentionPercent),
    lifeReferrals: toField(initial.lifeReferrals),
    meetingAttendance:
      initial.meetingAttendance === null
        ? "unset"
        : initial.meetingAttendance
          ? "yes"
          : "no",
  }));

  const save = useMutation({
    mutationFn: (inputs: StatementInputs) =>
      updatePayStatementInputs(statementId, inputs),
    onSuccess: async (updated) => {
      queryClient.setQueryData(payStatementKey(statementId), updated);
      onSaved();
      toast.success("Figures saved and the statement recalculated.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: payStatementsKey }),
        queryClient.invalidateQueries({ queryKey: payoutRunsKey }),
      ]);
    },
    onError: (error) => toast.error(payoutErrorMessage(error)),
  });

  const form = useAppForm({
    defaultValues,
    validators: { onBlur: inputsFormSchema },
    onSubmit: ({ value }) => save.mutate(inputsOf(value)),
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
          {needed.compliance && (
            <form.AppField name="compliancePercent">
              {(f) => (
                <f.PercentField
                  label="Compliance rate"
                  placeholder="Not entered"
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>
          )}
          {needed.retention && (
            <form.AppField name="retentionPercent">
              {(f) => (
                <f.PercentField
                  label="Retention"
                  description="At month end."
                  placeholder="Not entered"
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>
          )}
          {needed.referrals && (
            <form.AppField name="lifeReferrals">
              {(f) => (
                <f.NumberField
                  label="Valid life referrals"
                  inputMode="numeric"
                  step="1"
                  min="0"
                  placeholder="Not entered"
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>
          )}
          {needed.attendance && (
            <form.AppField name="meetingAttendance">
              {(f) => (
                <f.SelectField
                  label="Attended sales meetings"
                  options={ATTENDANCE_OPTIONS}
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>
          )}
        </FormGrid>
        <form.Subscribe selector={(state) => state.isDirty}>
          {(dirty) => (
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={!dirty || save.isPending}
            >
              {save.isPending ? "Saving…" : "Save figures"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </form.AppForm>
  );
}
