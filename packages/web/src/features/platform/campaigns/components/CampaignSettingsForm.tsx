import { Plus, X } from "lucide-react";
import { FormGrid, FormSection } from "@/components/form";
import { MultiSelect } from "@/components/common/MultiSelect";
import { Button } from "@/components/ui/button";
import { withForm } from "@/hooks/form";
import type { PlatformAgency } from "@/lib/platform-api";
import { ASSIGNMENT_MODE_LABELS } from "../campaign-format";
import {
  EMPTY_CAMPAIGN_FORM,
  emptyMarketPhone,
  emptySquareFootageBand,
} from "../campaign-schemas";

/**
 * Everything the run is priced and routed with, before the file is uploaded
 * (PAC-71).
 *
 * ## Why the transform half is hidden for a processed file
 *
 * `?source=processed` imports a file somebody else already ran through the
 * processor, so the floor, the discount table and the market phones are inert —
 * nothing reads them. They are still *sent* (the API requires a complete
 * settings snapshot, and a stored value is easier to explain than a half-empty
 * record), just not shown, because a control that cannot affect the outcome is
 * worse than no control.
 *
 * ⚠ Discount rates are **percentages** on screen and fractions on the wire. See
 * `campaign-schemas.ts`.
 */
export const CampaignSettingsForm = withForm({
  defaultValues: EMPTY_CAMPAIGN_FORM,
  props: {
    agencies: [] as readonly PlatformAgency[],
    /** `processed` hides the transform fields; assignment and recipients stay. */
    source: "vendor" as "vendor" | "processed",
    disabled: false,
  },
  render: function Render({ form, agencies, source, disabled }) {
    const isVendor = source === "vendor";

    return (
      <div className="space-y-4">
        <FormSection
          title="Campaign"
          description="What this run is called, and which week it belongs to."
        >
          <FormGrid>
            <form.AppField name="name">
              {(f) => (
                <f.TextField
                  label="Name"
                  description="Left blank, the week and file name are used."
                  placeholder="Week 36 — Allstate home"
                  disabled={disabled}
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>
            <form.AppField name="campaignNumber">
              {(f) => (
                <f.TextField
                  label="Campaign number"
                  description="Normalized to Week_Number-NN and printed on the piece."
                  placeholder="Week_Number-36"
                  disabled={disabled}
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>
          </FormGrid>
        </FormSection>

        <AssignmentSection
          form={form}
          agencies={agencies}
          disabled={disabled}
        />

        {isVendor && (
          <>
            <FormSection
              title="Pricing"
              description="The offer is the discounted premium, raised to the floor. On a real file ~95% of rows land on the floor."
            >
              <FormGrid>
                <form.AppField name="settings.premiumFloor">
                  {(f) => (
                    <f.NumberField
                      label="Premium floor"
                      description="Per campaign, never a constant."
                      step="0.01"
                      min="0"
                      disabled={disabled}
                      inputClassName="bg-card border-border"
                    />
                  )}
                </form.AppField>
                <form.AppField name="settings.runYear">
                  {(f) => (
                    <f.NumberField
                      label="Run year"
                      description="Drives the home-age discount. Re-running a past campaign needs its original year."
                      inputMode="numeric"
                      step="1"
                      disabled={disabled}
                      inputClassName="bg-card border-border"
                    />
                  )}
                </form.AppField>
              </FormGrid>
            </FormSection>

            <FormSection
              title="Discounts"
              titleAs="h3"
              description="Size and age discounts are added, not compounded, then the floor applies."
            >
              <form.Field name="settings.squareFootage" mode="array">
                {(field) => (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                      <span className="text-[10px] tracking-widest text-muted-foreground uppercase">
                        Square feet, at least
                      </span>
                      <span className="text-[10px] tracking-widest text-muted-foreground uppercase">
                        Discount %
                      </span>
                      <span className="sr-only">Remove</span>
                    </div>
                    {field.state.value.map((_, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-[1fr_1fr_auto] items-start gap-2"
                      >
                        <form.AppField
                          name={`settings.squareFootage[${index}].minSquareFeet`}
                        >
                          {(f) => (
                            <f.NumberField
                              inputMode="numeric"
                              step="1"
                              min="0"
                              disabled={disabled}
                              inputClassName="bg-card border-border"
                            />
                          )}
                        </form.AppField>
                        <form.AppField
                          name={`settings.squareFootage[${index}].ratePercent`}
                        >
                          {(f) => (
                            <f.NumberField
                              step="0.1"
                              min="0"
                              max="100"
                              disabled={disabled}
                              inputClassName="bg-card border-border"
                            />
                          )}
                        </form.AppField>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="mt-1 text-muted-foreground hover:text-foreground"
                          disabled={disabled || field.state.value.length <= 1}
                          aria-label={`Remove band ${index + 1}`}
                          onClick={() => {
                            field.removeValue(index);
                            // Removing a row fires no blur, so the array's own
                            // rules would not re-run until something else was
                            // touched.
                            field.handleBlur();
                          }}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      disabled={disabled}
                      onClick={() => field.pushValue(emptySquareFootageBand())}
                    >
                      <Plus className="size-4" />
                      Add a band
                    </Button>
                  </div>
                )}
              </form.Field>

              <FormGrid columns={3} gap={3}>
                <form.AppField name="settings.homeAge.maxNewYears">
                  {(f) => (
                    <f.NumberField
                      label="Newer than (years)"
                      inputMode="numeric"
                      step="1"
                      min="0"
                      disabled={disabled}
                      inputClassName="bg-card border-border"
                    />
                  )}
                </form.AppField>
                <form.AppField name="settings.homeAge.newRatePercent">
                  {(f) => (
                    <f.NumberField
                      label="Newer-home discount %"
                      step="0.1"
                      min="0"
                      max="100"
                      disabled={disabled}
                      inputClassName="bg-card border-border"
                    />
                  )}
                </form.AppField>
                <form.AppField name="settings.homeAge.oldRatePercent">
                  {(f) => (
                    <f.NumberField
                      label="Older-home discount %"
                      step="0.1"
                      min="0"
                      max="100"
                      disabled={disabled}
                      inputClassName="bg-card border-border"
                    />
                  )}
                </form.AppField>
              </FormGrid>
            </FormSection>

            <FormSection
              title="Markets and phones"
              description="A ZIP resolves to a market, and the market decides the local-presence number printed on the piece."
            >
              <FormGrid>
                <form.AppField name="settings.defaultMarket">
                  {(f) => (
                    <f.TextField
                      label="Default market"
                      description="Written when a ZIP is unmapped."
                      disabled={disabled}
                      inputClassName="bg-card border-border"
                    />
                  )}
                </form.AppField>
                <form.AppField name="settings.defaultPhone">
                  {(f) => (
                    <f.TextField
                      label="Default phone"
                      description="For any market without its own number."
                      disabled={disabled}
                      inputClassName="bg-card border-border"
                    />
                  )}
                </form.AppField>
              </FormGrid>

              <form.Field name="settings.marketPhones" mode="array">
                {(field) => (
                  <div className="space-y-2">
                    {field.state.value.length > 0 && (
                      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                        <span className="text-[10px] tracking-widest text-muted-foreground uppercase">
                          Market
                        </span>
                        <span className="text-[10px] tracking-widest text-muted-foreground uppercase">
                          Phone
                        </span>
                        <span className="sr-only">Remove</span>
                      </div>
                    )}
                    {field.state.value.map((_, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-[1fr_1fr_auto] items-start gap-2"
                      >
                        <form.AppField
                          name={`settings.marketPhones[${index}].market`}
                        >
                          {(f) => (
                            <f.TextField
                              placeholder="Tulsa"
                              disabled={disabled}
                              inputClassName="bg-card border-border"
                            />
                          )}
                        </form.AppField>
                        <form.AppField
                          name={`settings.marketPhones[${index}].phone`}
                        >
                          {(f) => (
                            <f.TextField
                              placeholder="918-984-6163"
                              disabled={disabled}
                              inputClassName="bg-card border-border"
                            />
                          )}
                        </form.AppField>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="mt-1 text-muted-foreground hover:text-foreground"
                          disabled={disabled}
                          aria-label={`Remove market ${index + 1}`}
                          onClick={() => {
                            field.removeValue(index);
                            field.handleBlur();
                          }}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      disabled={disabled}
                      onClick={() => field.pushValue(emptyMarketPhone())}
                    >
                      <Plus className="size-4" />
                      Add a market
                    </Button>
                  </div>
                )}
              </form.Field>
            </FormSection>

            <FormSection title="Output" titleAs="h3">
              <form.AppField name="settings.fileName">
                {(f) => (
                  <f.TextField
                    label="File name column"
                    description="Written to every row's FileName column. Apex uses the input name with RTP swapped for QBP."
                    placeholder="SFA-QBP"
                    disabled={disabled}
                    inputClassName="bg-card border-border"
                  />
                )}
              </form.AppField>
            </FormSection>
          </>
        )}

        <FormSection
          title="Completion email"
          description="Who gets a time-limited link to the output file once the import finishes. Leave blank for none."
        >
          <form.AppField name="settings.outputRecipients">
            {(f) => (
              <f.TextareaField
                label="Recipients"
                description="One address per line."
                rows={3}
                placeholder="print@vendor.example&#10;david@agency.example"
                disabled={disabled}
                textareaClassName="bg-card border-border"
              />
            )}
          </form.AppField>
        </FormSection>
      </div>
    );
  },
});

/**
 * Who the rows end up visible to.
 *
 * The default — **by carrier agency ID** — is the one that needs no decision:
 * the file's own `agencyid` column says whose prospects these are, matched
 * against the carrier appointments each agency holds. The other two modes are
 * deliberate overrides, and each says what it does rather than relying on the
 * mode name.
 */
const AssignmentSection = withForm({
  defaultValues: EMPTY_CAMPAIGN_FORM,
  props: {
    agencies: [] as readonly PlatformAgency[],
    disabled: false,
  },
  render: function Render({ form, agencies, disabled }) {
    const options = agencies.map((agency) => ({
      value: agency._id,
      label: agency.name,
    }));

    return (
      <FormSection
        title="Assignment"
        description="Which agencies can look these mailers up in their drawer."
      >
        <form.AppField name="assignment.mode">
          {(f) => (
            <f.SelectField
              label="Mode"
              options={[
                {
                  value: "carrier_agency_id",
                  label: `${ASSIGNMENT_MODE_LABELS.carrier_agency_id} — the file decides, per row`,
                  triggerLabel: ASSIGNMENT_MODE_LABELS.carrier_agency_id,
                },
                {
                  value: "agencies",
                  label: `${ASSIGNMENT_MODE_LABELS.agencies} — every row visible to all of them`,
                  triggerLabel: ASSIGNMENT_MODE_LABELS.agencies,
                },
                {
                  value: "all",
                  label: `${ASSIGNMENT_MODE_LABELS.all} — including ones onboarded later`,
                  triggerLabel: ASSIGNMENT_MODE_LABELS.all,
                },
              ]}
              disabled={disabled}
              triggerClassName="w-full bg-card border-border"
              contentClassName="max-w-[var(--radix-select-trigger-width)]"
              onChanged={(mode) => {
                // A list left behind from `agencies` would be sent with a mode
                // that rejects a non-empty one.
                if (mode !== "agencies") {
                  form.setFieldValue("assignment.agencyIds", []);
                }
              }}
            />
          )}
        </form.AppField>

        <form.Subscribe selector={(state) => state.values.assignment.mode}>
          {(mode) =>
            mode === "agencies" ? (
              <form.AppField name="assignment.agencyIds">
                {(f) => (
                  <div className="space-y-1.5">
                    <span className="text-[10px] tracking-widest text-muted-foreground uppercase">
                      Agencies
                    </span>
                    <MultiSelect
                      options={options}
                      value={f.state.value}
                      onChange={(value) => {
                        f.handleChange(value);
                        f.handleBlur();
                      }}
                      placeholder="Choose agencies"
                      summarize={(count) => `${count} agencies`}
                      className="w-full justify-between"
                    />
                    {f.state.meta.errors.length > 0 &&
                      f.state.meta.isTouched && (
                        <p className="text-xs text-destructive">
                          Choose at least one agency
                        </p>
                      )}
                  </div>
                )}
              </form.AppField>
            ) : mode === "all" ? (
              <p className="text-xs text-muted-foreground">
                Every agency, including ones onboarded after this run — the mode
                is stored, not an expanded list.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Each row goes to the agency holding an active appointment for its{" "}
                <code className="rounded bg-sunken px-1 py-0.5">agencyid</code>{" "}
                under this campaign's carrier. A code no agency holds blocks the
                commit — the preview says so before anything is written.
              </p>
            )
          }
        </form.Subscribe>
      </FormSection>
    );
  },
});
