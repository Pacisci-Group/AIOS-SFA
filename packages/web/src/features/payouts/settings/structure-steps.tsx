import { Plus, X } from "lucide-react";
import {
  ANY_CARRIER,
  MAX_BONUS_TIERS,
  MAX_CHARGEBACK_WINDOW_MONTHS,
  MAX_OVERRIDE_RULES,
  MAX_RATE_RULES,
  MAX_RATE_STEPS,
  MAX_REFERRAL_COUNT,
  MAX_SOLD_LOG_DAYS,
  MAX_STIPEND_MONTHS,
  type OverrideBasis,
  type RateStepBasis,
} from "@sfa/shared";
import { FormGrid, FormSection, FormSubPanel } from "@/components/form";
import type {
  ChecklistOption,
  ComboboxOption,
  SelectOption,
} from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import { withForm } from "@/hooks/form";
import { arrayMessage } from "../payout-form-fields";
import {
  emptyAgencyTierRow,
  emptyLeadSourceRow,
  emptyOverrideRow,
  emptyRateRow,
  emptyStepRow,
  emptyTierRow,
  newStructureValues,
} from "./structure-form";

/**
 * The three steps of the payment-structure editor (PAC-177): rates (carrier
 * rates, their minimum bundle rates and steps, lead-source rates, overrides
 * and the chargeback window), pay and bonuses, people (and their start
 * months, for a stipend). Each owns the fields `STRUCTURE_STEPS` lists for
 * it; the page validates one step at a time the way the onboarding wizard
 * does.
 */

const STEP_BASIS_OPTIONS: readonly SelectOption<RateStepBasis>[] = [
  { value: "premium", label: "Premium sold in the month, all carriers" },
  {
    value: "retention",
    label: "Retention at month end, entered on the statement",
  },
];

const OVERRIDE_BASIS_OPTIONS: readonly SelectOption<OverrideBasis>[] = [
  { value: "agency", label: "All the agency's premium" },
  { value: "lead_source", label: "What others sold from a lead source" },
];

/** The remove button on an array row's heading. */
function RemoveRowButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-muted-foreground hover:text-foreground"
      aria-label={label}
      onClick={onClick}
    >
      <X size={14} />
    </Button>
  );
}

/**
 * Rates: the carrier rates, then the lead-source overrides. Both pickers get
 * their options from the page — `leadSourceCarrierOptions` is the carrier
 * list with `*` reading "Any carrier", since an override for a source covers
 * every carrier, not "every other" one.
 */
export const RatesStep = withForm({
  defaultValues: newStructureValues(),
  props: {
    carrierOptions: [] as readonly ComboboxOption<string>[],
    leadSourceOptions: [] as readonly ComboboxOption<string>[],
    leadSourceCarrierOptions: [] as readonly ComboboxOption<string>[],
    /** The lead-source list failed to load; stored rules still render. */
    leadSourcesUnavailable: false,
  },
  render: function Render({
    form,
    carrierOptions,
    leadSourceOptions,
    leadSourceCarrierOptions,
    leadSourcesUnavailable,
  }) {
    return (
      <div className="space-y-4">
        <CarrierRatesSection form={form} carrierOptions={carrierOptions} />
        <LeadSourceRatesSection
          form={form}
          leadSourceOptions={leadSourceOptions}
          carrierOptions={leadSourceCarrierOptions}
          unavailable={leadSourcesUnavailable}
        />
        <OverridesSection
          form={form}
          leadSourceOptions={leadSourceOptions}
          carrierOptions={leadSourceCarrierOptions}
          leadSourcesUnavailable={leadSourcesUnavailable}
        />
        <FormSection
          title="Chargebacks"
          description="A chargeback comes off the premium of the sale it reverses. To stop charging back long after a cancellation, set a window."
        >
          <FormGrid gap={3}>
            <form.AppField name="chargebackWindow">
              {(f) => (
                <f.NumberField
                  label="Charge back for (months)"
                  description="Counted from the cancellation. Blank for no limit."
                  inputMode="numeric"
                  step="1"
                  min="1"
                  max={String(MAX_CHARGEBACK_WINDOW_MONTHS)}
                  placeholder="No limit"
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>
          </FormGrid>
        </FormSection>
      </div>
    );
  },
});

const CarrierRatesSection = withForm({
  defaultValues: newStructureValues(),
  props: {
    carrierOptions: [] as readonly ComboboxOption<string>[],
  },
  render: function Render({ form, carrierOptions }) {
    return (
      <FormSection
        title="Commission rates"
        description="A percentage of sold premium, per carrier. Add one rate for any other carrier so nothing is paid at 0% by accident."
      >
        <form.AppField name="name">
          {(f) => (
            <f.TextField
              label="Structure name"
              placeholder="Producers"
              autoComplete="off"
              inputClassName="bg-card border-border"
            />
          )}
        </form.AppField>

        <form.Field name="rules" mode="array">
          {(field) => {
            const message = arrayMessage(field.state.meta);
            return (
              <div className="space-y-3">
                {field.state.value.map((_, index) => (
                  <FormSubPanel
                    key={index}
                    title={`Rate ${index + 1}`}
                    action={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-muted-foreground hover:text-foreground"
                        aria-label={`Remove rate ${index + 1}`}
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
                      <form.AppField name={`rules[${index}].carrier`}>
                        {(f) => (
                          <f.ComboboxField
                            label="Carrier"
                            options={carrierOptions}
                            placeholder="Choose a carrier"
                            searchPlaceholder="Search carriers"
                            triggerClassName="w-full bg-card border-border"
                            onChanged={() => field.handleBlur()}
                          />
                        )}
                      </form.AppField>
                      <form.AppField name={`rules[${index}].ratePercent`}>
                        {(f) => (
                          <f.PercentField
                            label="Rate"
                            inputClassName="bg-card border-border"
                          />
                        )}
                      </form.AppField>
                    </FormGrid>
                    <form.AppField name={`rules[${index}].bundleEnforced`}>
                      {(f) => (
                        <f.CheckboxField
                          label="Enforce a minimum bundle rate"
                          hint={
                            f.state.value
                              ? "A bundle is a sale with two or more policies. Below the minimum, the statement is flagged for review; pay is not changed."
                              : undefined
                          }
                        />
                      )}
                    </form.AppField>
                    <form.Subscribe
                      selector={(state) =>
                        state.values.rules[index]?.bundleEnforced ?? false
                      }
                    >
                      {(enforced) =>
                        enforced ? (
                          <FormGrid gap={3}>
                            <form.AppField
                              name={`rules[${index}].minBundleRate`}
                            >
                              {(f) => (
                                <f.PercentField
                                  label="Minimum bundle rate"
                                  inputClassName="bg-card border-border"
                                />
                              )}
                            </form.AppField>
                          </FormGrid>
                        ) : null
                      }
                    </form.Subscribe>
                    <RateStepsBlock form={form} index={index} />
                  </FormSubPanel>
                ))}
                {message ? (
                  <p className="text-sm text-destructive">{message}</p>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={field.state.value.length >= MAX_RATE_RULES}
                  onClick={() => {
                    const hasCatchAll = field.state.value.some(
                      (row) => row.carrier === ANY_CARRIER,
                    );
                    field.pushValue(
                      emptyRateRow(hasCatchAll ? "" : ANY_CARRIER),
                    );
                  }}
                >
                  <Plus size={14} />
                  Add a rate
                </Button>
              </div>
            );
          }}
        </form.Field>
      </FormSection>
    );
  },
});

/**
 * A rate's optional steps (2026 comp plans): the highest step reached whose
 * minimums are met pays its rate on **all** the rule's premium — not split
 * across the steps — and the rule's own rate is the base below the first.
 */
const RateStepsBlock = withForm({
  defaultValues: newStructureValues(),
  props: { index: 0 },
  render: function Render({ form, index }) {
    return (
      <>
        <form.AppField name={`rules[${index}].stepped`}>
          {(f) => (
            <f.CheckboxField
              label="Step up the rate"
              hint={
                f.state.value
                  ? "The highest step reached pays its rate on all of this rate's premium, not only the part above it. Below the first step, the rate above is paid."
                  : undefined
              }
              onChanged={(on) => {
                // Ticking an empty list opens it with a step to fill in.
                if (on && !form.getFieldValue(`rules[${index}].steps`).length) {
                  form.pushFieldValue(`rules[${index}].steps`, emptyStepRow());
                }
              }}
            />
          )}
        </form.AppField>
        <form.Subscribe
          selector={(state) => state.values.rules[index]?.stepped ?? false}
        >
          {(stepped) =>
            stepped ? (
              <form.Field name={`rules[${index}].steps`} mode="array">
                {(stepsField) => {
                  const message = arrayMessage(stepsField.state.meta);
                  return (
                    <div className="space-y-3">
                      <FormGrid gap={3}>
                        <form.AppField name={`rules[${index}].stepBasis`}>
                          {(f) => (
                            <f.SelectField
                              label="Measured on"
                              options={STEP_BASIS_OPTIONS}
                              triggerClassName="w-full bg-card border-border"
                              onChanged={() => stepsField.handleBlur()}
                            />
                          )}
                        </form.AppField>
                      </FormGrid>
                      <p className="text-xs text-muted-foreground">
                        Minimums are optional. A step with them counts only when
                        the compliance rate entered on the statement and the
                        month&apos;s bundle rate (all carriers) meet them;
                        otherwise the highest step below it that does applies.
                      </p>
                      <form.Subscribe
                        selector={(state) =>
                          state.values.rules[index]?.stepBasis ?? "premium"
                        }
                      >
                        {(basis) =>
                          stepsField.state.value.map((_, step) => (
                            <FormSubPanel
                              key={step}
                              className="bg-card"
                              title={`Step ${step + 1}`}
                              action={
                                <RemoveRowButton
                                  label={`Remove step ${step + 1}`}
                                  onClick={() => {
                                    stepsField.removeValue(step);
                                    stepsField.handleBlur();
                                  }}
                                />
                              }
                            >
                              <FormGrid columns={3} gap={3}>
                                <form.AppField
                                  name={`rules[${index}].steps[${step}].threshold`}
                                >
                                  {(f) =>
                                    basis === "retention" ? (
                                      <f.PercentField
                                        label="When retention reaches"
                                        inputClassName="bg-card border-border"
                                      />
                                    ) : (
                                      <f.MoneyField
                                        label="When premium sold reaches"
                                        inputClassName="bg-card border-border"
                                      />
                                    )
                                  }
                                </form.AppField>
                                <form.AppField
                                  name={`rules[${index}].steps[${step}].ratePercent`}
                                >
                                  {(f) => (
                                    <f.PercentField
                                      label="Rate"
                                      inputClassName="bg-card border-border"
                                    />
                                  )}
                                </form.AppField>
                                <form.AppField
                                  name={`rules[${index}].steps[${step}].bonusAmount`}
                                >
                                  {(f) => (
                                    <f.MoneyField
                                      label="One-off bonus"
                                      placeholder="Optional"
                                      inputClassName="bg-card border-border"
                                    />
                                  )}
                                </form.AppField>
                                <form.AppField
                                  name={`rules[${index}].steps[${step}].minCompliance`}
                                >
                                  {(f) => (
                                    <f.PercentField
                                      label="Minimum compliance rate"
                                      placeholder="Optional"
                                      inputClassName="bg-card border-border"
                                    />
                                  )}
                                </form.AppField>
                                <form.AppField
                                  name={`rules[${index}].steps[${step}].minBundleRate`}
                                >
                                  {(f) => (
                                    <f.PercentField
                                      label="Minimum bundle rate"
                                      placeholder="Optional"
                                      inputClassName="bg-card border-border"
                                    />
                                  )}
                                </form.AppField>
                              </FormGrid>
                            </FormSubPanel>
                          ))
                        }
                      </form.Subscribe>
                      {message ? (
                        <p className="text-sm text-destructive">{message}</p>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={
                          stepsField.state.value.length >= MAX_RATE_STEPS
                        }
                        onClick={() => stepsField.pushValue(emptyStepRow())}
                      >
                        <Plus size={14} />
                        Add a step
                      </Button>
                    </div>
                  );
                }}
              </form.Field>
            ) : null
          }
        </form.Subscribe>
      </>
    );
  },
});

/**
 * Pay on premium other people sold (2026 comp plans): a share of every sale
 * in the agency on a carrier (the Office Manager's 1%), or of what others
 * sold from a lead source (Outside Sales' overflow leads).
 */
const OverridesSection = withForm({
  defaultValues: newStructureValues(),
  props: {
    leadSourceOptions: [] as readonly ComboboxOption<string>[],
    carrierOptions: [] as readonly ComboboxOption<string>[],
    leadSourcesUnavailable: false,
  },
  render: function Render({
    form,
    leadSourceOptions,
    carrierOptions,
    leadSourcesUnavailable,
  }) {
    return (
      <FormSection
        title="Overrides"
        description="Pay on premium other people sold. All the agency's premium counts everyone's sales, theirs included; a lead source counts only what others sold from it."
      >
        <form.Field name="overrides" mode="array">
          {(field) => {
            const message = arrayMessage(field.state.meta);
            return (
              <div className="space-y-3">
                {field.state.value.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No overrides.</p>
                ) : null}
                {field.state.value.map((_, index) => (
                  <FormSubPanel
                    key={index}
                    title={`Override ${index + 1}`}
                    action={
                      <RemoveRowButton
                        label={`Remove override ${index + 1}`}
                        onClick={() => {
                          field.removeValue(index);
                          field.handleBlur();
                        }}
                      />
                    }
                  >
                    <FormGrid gap={3}>
                      <form.AppField name={`overrides[${index}].basis`}>
                        {(f) => (
                          <f.SelectField
                            label="Paid on"
                            options={OVERRIDE_BASIS_OPTIONS}
                            triggerClassName="w-full bg-card border-border"
                            onChanged={() => field.handleBlur()}
                          />
                        )}
                      </form.AppField>
                      <form.Subscribe
                        selector={(state) =>
                          state.values.overrides[index]?.basis === "lead_source"
                        }
                      >
                        {(bySource) =>
                          bySource ? (
                            <form.AppField
                              name={`overrides[${index}].leadSourceId`}
                            >
                              {(f) => (
                                <f.ComboboxField
                                  label="Lead source"
                                  options={leadSourceOptions}
                                  placeholder="Choose a lead source"
                                  searchPlaceholder="Search lead sources"
                                  emptyText={
                                    leadSourcesUnavailable
                                      ? "The lead sources couldn't be loaded."
                                      : "No lead source matches."
                                  }
                                  triggerClassName="w-full bg-card border-border"
                                  onChanged={() => field.handleBlur()}
                                />
                              )}
                            </form.AppField>
                          ) : null
                        }
                      </form.Subscribe>
                      <form.AppField name={`overrides[${index}].carrier`}>
                        {(f) => (
                          <f.ComboboxField
                            label="Carrier"
                            options={carrierOptions}
                            placeholder="Choose a carrier"
                            searchPlaceholder="Search carriers"
                            triggerClassName="w-full bg-card border-border"
                            onChanged={() => field.handleBlur()}
                          />
                        )}
                      </form.AppField>
                      <form.AppField name={`overrides[${index}].ratePercent`}>
                        {(f) => (
                          <f.PercentField
                            label="Rate"
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
                  disabled={field.state.value.length >= MAX_OVERRIDE_RULES}
                  onClick={() => field.pushValue(emptyOverrideRow())}
                >
                  <Plus size={14} />
                  Add an override
                </Button>
              </div>
            );
          }}
        </form.Field>
      </FormSection>
    );
  },
});

const LeadSourceRatesSection = withForm({
  defaultValues: newStructureValues(),
  props: {
    leadSourceOptions: [] as readonly ComboboxOption<string>[],
    carrierOptions: [] as readonly ComboboxOption<string>[],
    unavailable: false,
  },
  render: function Render({
    form,
    leadSourceOptions,
    carrierOptions,
    unavailable,
  }) {
    return (
      <FormSection
        title="Lead source rates"
        description="Sales from these lead sources are paid this rate instead of the carrier rate. A rule that names a carrier beats one for any carrier. A carrier's minimum bundle rate still covers these sales."
      >
        <form.Field name="leadSourceRules" mode="array">
          {(field) => {
            const message = arrayMessage(field.state.meta);
            return (
              <div className="space-y-3">
                {unavailable ? (
                  <p className="text-sm text-destructive">
                    The lead sources couldn&apos;t be loaded, so no new
                    lead-source rate can be added. Reload the page to try again.
                  </p>
                ) : null}
                {field.state.value.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    None — everyone on this structure is paid the carrier rates
                    above.
                  </p>
                ) : null}
                {field.state.value.map((_, index) => (
                  <FormSubPanel
                    key={index}
                    title={`Lead-source rate ${index + 1}`}
                    action={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-muted-foreground hover:text-foreground"
                        aria-label={`Remove lead-source rate ${index + 1}`}
                        onClick={() => {
                          field.removeValue(index);
                          field.handleBlur();
                        }}
                      >
                        <X size={14} />
                      </Button>
                    }
                  >
                    <FormGrid columns={3} gap={3}>
                      <form.AppField
                        name={`leadSourceRules[${index}].leadSourceId`}
                      >
                        {(f) => (
                          <f.ComboboxField
                            label="Lead source"
                            options={leadSourceOptions}
                            placeholder="Choose a lead source"
                            searchPlaceholder="Search lead sources"
                            emptyText="No lead source matches."
                            triggerClassName="w-full bg-card border-border"
                            onChanged={() => field.handleBlur()}
                          />
                        )}
                      </form.AppField>
                      <form.AppField name={`leadSourceRules[${index}].carrier`}>
                        {(f) => (
                          <f.ComboboxField
                            label="Carrier"
                            options={carrierOptions}
                            placeholder="Choose a carrier"
                            searchPlaceholder="Search carriers"
                            triggerClassName="w-full bg-card border-border"
                            onChanged={() => field.handleBlur()}
                          />
                        )}
                      </form.AppField>
                      <form.AppField
                        name={`leadSourceRules[${index}].ratePercent`}
                      >
                        {(f) => (
                          <f.PercentField
                            label="Rate"
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
                  disabled={
                    unavailable || field.state.value.length >= MAX_RATE_RULES
                  }
                  onClick={() => field.pushValue(emptyLeadSourceRow())}
                >
                  <Plus size={14} />
                  Add a lead-source rate
                </Button>
              </div>
            );
          }}
        </form.Field>
      </FormSection>
    );
  },
});

/**
 * Pay and bonuses: base pay and the stipend, the hat trick, monthly tiers,
 * the agency premium bonus, the team bonus and its requirements, then the
 * two things that can take pay away — the referral rule and the compliance
 * floor. `carrierOptions` reads `*` as "Any carrier": the agency bonus on
 * `*` is measured on all the agency's premium.
 */
export const BonusesStep = withForm({
  defaultValues: newStructureValues(),
  props: {
    carrierOptions: [] as readonly ComboboxOption<string>[],
  },
  render: function Render({ form, carrierOptions }) {
    return (
      <div className="space-y-4">
        <FormSection
          title="Base pay and stipend"
          description="Base pay is paid every month. A stipend pays an amount for month 1, 2, 3… counted from each person's start month, which you set on the People step."
        >
          <FormGrid gap={3}>
            <form.AppField name="basePay">
              {(f) => (
                <f.MoneyField
                  label="Base pay per month"
                  placeholder="None"
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>
          </FormGrid>
          <form.Field name="stipendAmounts" mode="array">
            {(field) => {
              const message = arrayMessage(field.state.meta);
              const months = field.state.value.length;
              return (
                <div className="space-y-3">
                  {months === 0 ? (
                    <p className="text-sm text-muted-foreground">No stipend.</p>
                  ) : (
                    <FormGrid columns={3} gap={3}>
                      {field.state.value.map((_, index) => (
                        <form.AppField
                          key={index}
                          name={`stipendAmounts[${index}]`}
                        >
                          {(f) => (
                            <f.MoneyField
                              label={`Month ${index + 1}`}
                              inputClassName="bg-card border-border"
                            />
                          )}
                        </form.AppField>
                      ))}
                    </FormGrid>
                  )}
                  {message ? (
                    <p className="text-sm text-destructive">{message}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={months >= MAX_STIPEND_MONTHS}
                      onClick={() => field.pushValue("")}
                    >
                      <Plus size={14} />
                      Add a month
                    </Button>
                    {months > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          field.removeValue(months - 1);
                          field.handleBlur();
                        }}
                      >
                        <X size={14} />
                        Remove month {months}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            }}
          </form.Field>
        </FormSection>

        <FormSection
          title="Hat trick"
          description="A bonus for every day someone books this many sales or more, counted on the agency's calendar."
        >
          <form.AppField name="hatTrickEnabled">
            {(f) => <f.CheckboxField label="Pay a hat-trick bonus" />}
          </form.AppField>
          <form.Subscribe selector={(state) => state.values.hatTrickEnabled}>
            {(enabled) =>
              enabled ? (
                <FormGrid gap={3}>
                  <form.AppField name="dealsPerDay">
                    {(f) => (
                      <f.NumberField
                        label="Sales in one day"
                        inputMode="numeric"
                        step="1"
                        min="2"
                        max="20"
                        inputClassName="bg-card border-border"
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="hatTrickBonus">
                    {(f) => (
                      <f.MoneyField
                        label="Bonus per day"
                        inputClassName="bg-card border-border"
                      />
                    )}
                  </form.AppField>
                </FormGrid>
              ) : null
            }
          </form.Subscribe>
        </FormSection>

        <FormSection
          title="Monthly bonus tiers"
          description="Sell at least the threshold in a month and earn the bonus. A tier with a minimum compliance rate pays only when the rate entered on the statement meets it. Leave empty for none."
        >
          <form.AppField name="tiersStackable">
            {(f) => (
              <f.CheckboxField
                label="Stackable: pay every tier reached"
                hint={
                  f.state.value
                    ? "Every tier reached pays, and the bonuses add up."
                    : "Only the highest tier reached pays."
                }
              />
            )}
          </form.AppField>
          <form.Field name="tiers" mode="array">
            {(field) => {
              const message = arrayMessage(field.state.meta);
              return (
                <div className="space-y-3">
                  {field.state.value.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No monthly tiers.
                    </p>
                  ) : null}
                  {field.state.value.map((_, index) => (
                    <FormSubPanel
                      key={index}
                      title={`Tier ${index + 1}`}
                      action={
                        <RemoveRowButton
                          label={`Remove tier ${index + 1}`}
                          onClick={() => {
                            field.removeValue(index);
                            field.handleBlur();
                          }}
                        />
                      }
                    >
                      <FormGrid columns={3} gap={3}>
                        <form.AppField
                          name={`tiers[${index}].thresholdPremium`}
                        >
                          {(f) => (
                            <f.MoneyField
                              label="Premium sold in the month"
                              inputClassName="bg-card border-border"
                            />
                          )}
                        </form.AppField>
                        <form.AppField name={`tiers[${index}].bonusAmount`}>
                          {(f) => (
                            <f.MoneyField
                              label="Bonus"
                              inputClassName="bg-card border-border"
                            />
                          )}
                        </form.AppField>
                        <form.AppField name={`tiers[${index}].minCompliance`}>
                          {(f) => (
                            <f.PercentField
                              label="Minimum compliance rate"
                              placeholder="Optional"
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
                    onClick={() => field.pushValue(emptyTierRow())}
                  >
                    <Plus size={14} />
                    Add a tier
                  </Button>
                </div>
              );
            }}
          </form.Field>
        </FormSection>

        <FormSection
          title="Agency premium bonus"
          description="A personal bonus on everything the agency sells on one carrier, or on all carriers, in the month. Only the highest tier reached pays. Leave empty for none."
        >
          <form.Field name="agencyTiers" mode="array">
            {(field) => {
              const message = arrayMessage(field.state.meta);
              return (
                <div className="space-y-3">
                  {field.state.value.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No agency premium bonus.
                    </p>
                  ) : (
                    <FormGrid gap={3}>
                      <form.AppField name="agencyTiersCarrier">
                        {(f) => (
                          <f.ComboboxField
                            label="Agency premium on"
                            options={carrierOptions}
                            placeholder="Choose a carrier"
                            searchPlaceholder="Search carriers"
                            triggerClassName="w-full bg-card border-border"
                          />
                        )}
                      </form.AppField>
                    </FormGrid>
                  )}
                  {field.state.value.map((_, index) => (
                    <FormSubPanel
                      key={index}
                      title={`Agency tier ${index + 1}`}
                      action={
                        <RemoveRowButton
                          label={`Remove agency tier ${index + 1}`}
                          onClick={() => {
                            field.removeValue(index);
                            field.handleBlur();
                          }}
                        />
                      }
                    >
                      <FormGrid gap={3}>
                        <form.AppField
                          name={`agencyTiers[${index}].thresholdPremium`}
                        >
                          {(f) => (
                            <f.MoneyField
                              label="Agency premium in the month"
                              inputClassName="bg-card border-border"
                            />
                          )}
                        </form.AppField>
                        <form.AppField
                          name={`agencyTiers[${index}].bonusAmount`}
                        >
                          {(f) => (
                            <f.MoneyField
                              label="Bonus"
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
                    onClick={() => field.pushValue(emptyAgencyTierRow())}
                  >
                    <Plus size={14} />
                    Add an agency tier
                  </Button>
                </div>
              );
            }}
          </form.Field>
        </FormSection>

        <FormSection
          title="Team bonus"
          description="When the agency's month clears the threshold in Payout settings, the pool is shared among everyone on structures that take part."
        >
          <form.AppField name="teamBonusEligible">
            {(f) => (
              <f.CheckboxField label="People on this structure share the team bonus" />
            )}
          </form.AppField>
          <form.Subscribe selector={(state) => state.values.teamBonusEligible}>
            {(eligible) =>
              eligible ? (
                <FormSubPanel title="To take a share">
                  <FormGrid gap={3}>
                    <form.AppField name="soldLogDays">
                      {(f) => (
                        <f.NumberField
                          label="Enter every sale within (days)"
                          description="Of its sold date. Blank: not required."
                          inputMode="numeric"
                          step="1"
                          min="0"
                          max={String(MAX_SOLD_LOG_DAYS)}
                          placeholder="Not required"
                          inputClassName="bg-card border-border"
                        />
                      )}
                    </form.AppField>
                  </FormGrid>
                  <form.AppField name="meetingAttendance">
                    {(f) => (
                      <f.CheckboxField
                        label="Attend the sales meetings"
                        hint={
                          f.state.value
                            ? "The manager ticks attendance on each statement. Until it is entered, there is no share."
                            : undefined
                        }
                      />
                    )}
                  </form.AppField>
                </FormSubPanel>
              ) : null
            }
          </form.Subscribe>
        </FormSection>

        <FormSection
          title="Life referrals"
          description="The manager enters the month's valid life referrals on each statement. Below the minimum costs the deduction; reaching the bonus threshold earns the bonus."
        >
          <form.AppField name="referralEnabled">
            {(f) => <f.CheckboxField label="Count life referrals" />}
          </form.AppField>
          <form.Subscribe selector={(state) => state.values.referralEnabled}>
            {(enabled) =>
              enabled ? (
                <FormGrid gap={3}>
                  <form.AppField name="referralMinimum">
                    {(f) => (
                      <f.NumberField
                        label="Minimum each month"
                        inputMode="numeric"
                        step="1"
                        min="0"
                        max={String(MAX_REFERRAL_COUNT)}
                        inputClassName="bg-card border-border"
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="referralDeduction">
                    {(f) => (
                      <f.MoneyField
                        label="Deduction below the minimum"
                        inputClassName="bg-card border-border"
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="referralBonusThreshold">
                    {(f) => (
                      <f.NumberField
                        label="Bonus from (referrals)"
                        inputMode="numeric"
                        step="1"
                        min="1"
                        max={String(MAX_REFERRAL_COUNT)}
                        placeholder="No bonus"
                        inputClassName="bg-card border-border"
                      />
                    )}
                  </form.AppField>
                  <form.Subscribe
                    selector={(state) =>
                      state.values.referralBonusThreshold.trim() !== ""
                    }
                  >
                    {(hasThreshold) =>
                      hasThreshold ? (
                        <form.AppField name="referralBonus">
                          {(f) => (
                            <f.MoneyField
                              label="Bonus"
                              inputClassName="bg-card border-border"
                            />
                          )}
                        </form.AppField>
                      ) : null
                    }
                  </form.Subscribe>
                </FormGrid>
              ) : null
            }
          </form.Subscribe>
        </FormSection>

        <FormSection
          title="Compliance floor"
          description="The manager enters each person's compliance rate on their statement."
        >
          <form.AppField name="floorEnabled">
            {(f) => (
              <f.CheckboxField
                label="Set a compliance floor"
                hint={
                  f.state.value
                    ? "Below the floor: no Salesperson of the Month, hat trick, team or tier bonuses, every rate at its base, and the reduction taken off variable pay. Base pay and the stipend are not reduced."
                    : undefined
                }
              />
            )}
          </form.AppField>
          <form.Subscribe selector={(state) => state.values.floorEnabled}>
            {(enabled) =>
              enabled ? (
                <FormGrid gap={3}>
                  <form.AppField name="floorMinimum">
                    {(f) => (
                      <f.PercentField
                        label="Minimum compliance rate"
                        inputClassName="bg-card border-border"
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="floorReduction">
                    {(f) => (
                      <f.PercentField
                        label="Pay reduction below it"
                        inputClassName="bg-card border-border"
                      />
                    )}
                  </form.AppField>
                </FormGrid>
              ) : null
            }
          </form.Subscribe>
        </FormSection>
      </div>
    );
  },
});

/**
 * People, and — when the structure pays a stipend — each one's start month,
 * which is month 1 of the stipend. `monthOptions` comes from the page (the
 * agency's calendar), with a "Not set" entry first.
 */
export const PeopleStep = withForm({
  defaultValues: newStructureValues(),
  props: {
    options: [] as readonly ChecklistOption[],
    monthOptions: [] as readonly SelectOption<string>[],
  },
  render: function Render({ form, options, monthOptions }) {
    return (
      <div className="space-y-4">
        <FormSection
          title="People"
          description="A person is on one structure at a time. Ticking someone who is on another moves them here when you save."
        >
          <form.Subscribe selector={(state) => state.values.memberIds.length}>
            {(count) => (
              <p className="text-sm text-muted-foreground">
                {count === 1 ? "1 person selected" : `${count} people selected`}
              </p>
            )}
          </form.Subscribe>
          <form.AppField name="memberIds">
            {(f) => (
              <f.ChecklistField
                options={options}
                searchPlaceholder="Search people"
                emptyText="Nobody matches."
              />
            )}
          </form.AppField>
        </FormSection>

        <form.Subscribe
          selector={(state) => state.values.stipendAmounts.length > 0}
        >
          {(hasStipend) =>
            hasStipend ? (
              <FormSection
                title="Start months"
                description="Month 1 of the stipend is each person's start month. Without one, no stipend is paid."
              >
                <form.Field name="memberStarts">
                  {(startsField) => {
                    const message = arrayMessage(startsField.state.meta);
                    return (
                      <form.Subscribe
                        selector={(state) => state.values.memberIds}
                      >
                        {(memberIds) =>
                          memberIds.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              Tick people above to set their start months.
                            </p>
                          ) : (
                            <div className="space-y-3">
                              <FormGrid columns={3} gap={3}>
                                {memberIds.map((userId) => (
                                  <form.AppField
                                    key={userId}
                                    name={`memberStarts.${userId}`}
                                  >
                                    {(f) => (
                                      <f.SelectField
                                        label={
                                          options.find(
                                            (option) => option.value === userId,
                                          )?.label ?? userId
                                        }
                                        options={monthOptions}
                                        placeholder="Not set"
                                        triggerClassName="w-full bg-card border-border"
                                        onChanged={() =>
                                          startsField.handleBlur()
                                        }
                                      />
                                    )}
                                  </form.AppField>
                                ))}
                              </FormGrid>
                              {message ? (
                                <p className="text-sm text-destructive">
                                  {message}
                                </p>
                              ) : null}
                            </div>
                          )
                        }
                      </form.Subscribe>
                    );
                  }}
                </form.Field>
              </FormSection>
            ) : null
          }
        </form.Subscribe>
      </div>
    );
  },
});
