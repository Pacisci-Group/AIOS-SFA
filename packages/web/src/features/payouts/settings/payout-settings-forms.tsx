import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import {
  MAX_BONUS_TIERS,
  producerOfYearError,
  teamLevelsError,
  teamSplitError,
  type PayoutSettingsView,
  type ProducerOfYearSettings,
  type SalespersonOfMonthSettings,
  type TeamBonusSettings,
} from "@sfa/shared";
import { FormGrid, FormSubPanel } from "@/components/form";
import { Button } from "@/components/ui/button";
import { useAppForm } from "@/hooks/form";
import { payoutSettingsKey, updatePayoutSettings } from "@/lib/payouts-api";
import { payoutErrorMessage } from "../payout-errors";
import {
  arrayMessage,
  moneyString,
  percentString,
  toField,
  wholeString,
} from "../payout-form-fields";

/**
 * The agency-wide payout settings forms (PAC-177; Producer of the Year, 2026
 * comp plans). Each saves its own
 * section whole — the API refuses half a team bonus — and is remounted from
 * the stored value after its own save (a `key` per form on the caller, so
 * saving one never resets unsaved edits in the other).
 *
 * The team bonus is a list of levels (agency premium → pool) that either
 * stack — every level reached pays — or pay only the highest one reached.
 */

const levelRowSchema = z.object({
  thresholdPremium: moneyString("Enter a premium").refine(
    (value) => Number(value) > 0,
    "More than $0",
  ),
  poolAmount: moneyString("Enter the pool"),
});

const emptyLevelRow = () => ({ thresholdPremium: "", poolAmount: "" });

const teamBonusFormSchema = z
  .object({
    enabled: z.boolean(),
    stackable: z.boolean(),
    levels: z.array(levelRowSchema),
    csrSharePercent: percentString("Enter the CSR share"),
    producerSharePercent: percentString("Enter the producer share"),
  })
  .superRefine((values, ctx) => {
    // The cross-row rules once every row parses, so a half-typed row shows
    // its own message first — the structure editor's tiers do the same.
    const rows = values.levels.map((row) => levelRowSchema.safeParse(row));
    if (rows.every((row) => row.success)) {
      const error = teamLevelsError(
        values.levels.map((row) => ({
          thresholdPremium: Number(row.thresholdPremium),
          poolAmount: Number(row.poolAmount),
        })),
        { stackable: values.stackable, enabled: values.enabled },
      );
      if (error) {
        ctx.addIssue({ code: "custom", path: ["levels"], message: error });
      }
    }
    const csr = Number(values.csrSharePercent);
    const producer = Number(values.producerSharePercent);
    if (Number.isNaN(csr) || Number.isNaN(producer)) return;
    const error = teamSplitError(csr, producer);
    if (!error) return;
    // On both shares: a field shows its error only once touched, and the
    // owner may have changed either one.
    for (const path of ["csrSharePercent", "producerSharePercent"] as const) {
      ctx.addIssue({ code: "custom", path: [path], message: error });
    }
  });

type TeamBonusFormValues = z.infer<typeof teamBonusFormSchema>;

function useSaveSettings(onSaved: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatePayoutSettings,
    onSuccess: (settings: PayoutSettingsView) => {
      queryClient.setQueryData(payoutSettingsKey, settings);
      toast.success("Payout settings saved.");
      onSaved();
    },
    onError: (error) => toast.error(payoutErrorMessage(error)),
  });
}

export function TeamBonusForm({
  initial,
  onSaved,
}: {
  initial: TeamBonusSettings;
  onSaved: () => void;
}) {
  const save = useSaveSettings(onSaved);
  const [defaultValues] = useState<TeamBonusFormValues>(() => ({
    enabled: initial.enabled,
    stackable: initial.stackable,
    levels: initial.levels.map((level) => ({
      thresholdPremium: toField(level.thresholdPremium),
      poolAmount: toField(level.poolAmount),
    })),
    csrSharePercent: toField(initial.csrSharePercent),
    producerSharePercent: toField(initial.producerSharePercent),
  }));

  const form = useAppForm({
    defaultValues,
    validators: { onBlur: teamBonusFormSchema },
    onSubmit: ({ value }) =>
      save.mutate({
        teamBonus: {
          enabled: value.enabled,
          stackable: value.stackable,
          levels: value.levels.map((level) => ({
            thresholdPremium: Number(level.thresholdPremium),
            poolAmount: Number(level.poolAmount),
          })),
          csrSharePercent: Number(value.csrSharePercent),
          producerSharePercent: Number(value.producerSharePercent),
        },
      }),
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
        <form.AppField name="enabled">
          {(f) => <f.CheckboxField label="Pay a team bonus" />}
        </form.AppField>
        <form.AppField name="stackable">
          {(f) => (
            <f.CheckboxField
              label="Stackable: pay every level reached"
              hint={
                f.state.value
                  ? "Every level the month reaches pays; the pools add up."
                  : "Only the highest level the month reaches pays."
              }
            />
          )}
        </form.AppField>
        <form.Field name="levels" mode="array">
          {(field) => {
            const message = arrayMessage(field.state.meta);
            return (
              <div className="space-y-3">
                {field.state.value.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No levels yet.
                  </p>
                ) : null}
                {field.state.value.map((_, index) => (
                  <FormSubPanel
                    key={index}
                    title={`Level ${index + 1}`}
                    action={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-muted-foreground hover:text-foreground"
                        aria-label={`Remove level ${index + 1}`}
                        onClick={() => {
                          field.removeValue(index);
                          field.handleBlur();
                        }}
                      >
                        <X size={14} />
                      </Button>
                    }
                  >
                    <FormGrid gap={3}>
                      <form.AppField name={`levels[${index}].thresholdPremium`}>
                        {(f) => (
                          <f.MoneyField
                            label="Agency premium in the month"
                            inputClassName="bg-card border-border"
                          />
                        )}
                      </form.AppField>
                      <form.AppField name={`levels[${index}].poolAmount`}>
                        {(f) => (
                          <f.MoneyField
                            label="Pool"
                            inputClassName="bg-card border-border"
                          />
                        )}
                      </form.AppField>
                    </FormGrid>
                  </FormSubPanel>
                ))}
                {message ? (
                  <p className="text-sm text-destructive">{message}</p>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={field.state.value.length >= MAX_BONUS_TIERS}
                  onClick={() => field.pushValue(emptyLevelRow())}
                >
                  <Plus size={14} />
                  Add a level
                </Button>
              </div>
            );
          }}
        </form.Field>
        <FormGrid gap={3}>
          <form.AppField name="csrSharePercent">
            {(f) => (
              <f.PercentField
                label="CSRs' share"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="producerSharePercent">
            {(f) => (
              <f.PercentField
                label="Producers' share"
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
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </form.AppForm>
  );
}

/*
 * `somEnabled`, not `enabled`: a checkbox's id is its field name, and the
 * team bonus card on the same page already has an `enabled` — two ids alike
 * made this card's label tick the team bonus box instead.
 */
const somFormSchema = z.object({
  somEnabled: z.boolean(),
  bonusAmount: moneyString("Enter the bonus"),
});

type SomFormValues = z.infer<typeof somFormSchema>;

export function SalespersonOfMonthForm({
  initial,
  onSaved,
}: {
  initial: SalespersonOfMonthSettings;
  onSaved: () => void;
}) {
  const save = useSaveSettings(onSaved);
  const [defaultValues] = useState<SomFormValues>(() => ({
    somEnabled: initial.enabled,
    bonusAmount: toField(initial.bonusAmount),
  }));

  const form = useAppForm({
    defaultValues,
    validators: { onBlur: somFormSchema },
    onSubmit: ({ value }) =>
      save.mutate({
        salespersonOfMonth: {
          enabled: value.somEnabled,
          bonusAmount: Number(value.bonusAmount),
        },
      }),
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
        <form.AppField name="somEnabled">
          {(f) => (
            <f.CheckboxField label="Pay a Salesperson of the Month bonus" />
          )}
        </form.AppField>
        <form.AppField name="bonusAmount">
          {(f) => (
            <f.MoneyField
              label="Bonus"
              description="Ties all win it."
              inputClassName="bg-card border-border"
            />
          )}
        </form.AppField>
        <form.Subscribe selector={(state) => state.isDirty}>
          {(dirty) => (
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={!dirty || save.isPending}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </form.AppForm>
  );
}

/*
 * `poy`-prefixed names for the same reason as `somEnabled`: a checkbox's id
 * is its field name, and the other cards on the page have an `enabled` and a
 * `bonusAmount` of their own.
 */
const poyFieldSchemas = {
  poyBonus: moneyString("Enter the bonus"),
  poyMonths: wholeString("Enter a number of months", { min: 0, max: 12 }),
  poyCompliance: percentString("Enter a compliance rate"),
};

const poyFormSchema = z
  .object({ poyEnabled: z.boolean(), ...poyFieldSchemas })
  .superRefine((values, ctx) => {
    // The shared rules once every field parses, so a field shows its own
    // message first.
    const parsed = (
      Object.keys(poyFieldSchemas) as (keyof typeof poyFieldSchemas)[]
    ).every((key) => poyFieldSchemas[key].safeParse(values[key]).success);
    if (!parsed) return;
    const error = producerOfYearError(poySettingsOf(values));
    if (error) {
      ctx.addIssue({ code: "custom", path: ["poyMonths"], message: error });
    }
  });

type PoyFormValues = z.infer<typeof poyFormSchema>;

function poySettingsOf(values: PoyFormValues): ProducerOfYearSettings {
  return {
    enabled: values.poyEnabled,
    bonusAmount: Number(values.poyBonus),
    minCompliantMonths: Number(values.poyMonths),
    minCompliancePercent: Number(values.poyCompliance),
  };
}

/**
 * Producer of the Year: a bonus on the December statement to the year's top
 * producer by sold premium who was compliant — an entered compliance rate at
 * least this high — in enough months of the year. Saved whole.
 */
export function ProducerOfYearForm({
  initial,
  onSaved,
}: {
  initial: ProducerOfYearSettings;
  onSaved: () => void;
}) {
  const save = useSaveSettings(onSaved);
  const [defaultValues] = useState<PoyFormValues>(() => ({
    poyEnabled: initial.enabled,
    poyBonus: toField(initial.bonusAmount),
    poyMonths: toField(initial.minCompliantMonths),
    poyCompliance: toField(initial.minCompliancePercent),
  }));

  const form = useAppForm({
    defaultValues,
    validators: { onBlur: poyFormSchema },
    onSubmit: ({ value }) =>
      save.mutate({ producerOfYear: poySettingsOf(value) }),
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
        <form.AppField name="poyEnabled">
          {(f) => <f.CheckboxField label="Pay a Producer of the Year bonus" />}
        </form.AppField>
        <form.AppField name="poyBonus">
          {(f) => (
            <f.MoneyField
              label="Bonus"
              description="On the December statement. Ties all win it."
              inputClassName="bg-card border-border"
            />
          )}
        </form.AppField>
        <FormGrid gap={3}>
          <form.AppField name="poyMonths">
            {(f) => (
              <f.NumberField
                label="Compliant months needed"
                description="Out of the year's 12."
                inputMode="numeric"
                step="1"
                min="0"
                max="12"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="poyCompliance">
            {(f) => (
              <f.PercentField
                label="Compliance rate that counts a month"
                description="As entered on each statement."
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
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </form.AppForm>
  );
}
