import { Plus, X } from "lucide-react";
import { ANY_CARRIER, MAX_BONUS_TIERS, MAX_RATE_RULES } from "@sfa/shared";
import { FormGrid, FormSection, FormSubPanel } from "@/components/form";
import type { ChecklistOption, ComboboxOption } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import { withForm } from "@/hooks/form";
import { arrayMessage } from "../payout-form-fields";
import {
  emptyLeadSourceRow,
  emptyRateRow,
  emptyTierRow,
  newStructureValues,
} from "./structure-form";

/**
 * The three steps of the payment-structure editor (PAC-177): rates (carrier
 * rates, their minimum bundle rates, and lead-source overrides), bonuses,
 * people. Each owns the fields `STRUCTURE_STEPS` lists for it; the page
 * validates one step at a time the way the onboarding wizard does.
 */

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

export const BonusesStep = withForm({
  defaultValues: newStructureValues(),
  render: function Render({ form }) {
    return (
      <div className="space-y-4">
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
          description="Sell at least the threshold in a month and earn the bonus. Leave empty for none."
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-muted-foreground hover:text-foreground"
                          aria-label={`Remove tier ${index + 1}`}
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
          title="Team bonus"
          description="When the agency's month clears the threshold in Payout settings, the pool is shared among everyone on structures that take part."
        >
          <form.AppField name="teamBonusEligible">
            {(f) => (
              <f.CheckboxField label="People on this structure share the team bonus" />
            )}
          </form.AppField>
        </FormSection>
      </div>
    );
  },
});

export const PeopleStep = withForm({
  defaultValues: newStructureValues(),
  props: {
    options: [] as readonly ChecklistOption[],
  },
  render: function Render({ form, options }) {
    return (
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
    );
  },
});
