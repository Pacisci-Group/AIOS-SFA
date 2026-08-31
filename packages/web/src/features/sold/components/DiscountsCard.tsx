import type { UploadScope } from "@/lib/sold-deals-api";
import type { SoldHouseholdContact } from "@sfa/shared";
import { isAutoPolicyType, isPropertyPolicyType } from "@sfa/shared";
import { useStore } from "@tanstack/react-form";
import { Plus, X } from "lucide-react";
import { AddressFields } from "@/components/address/AddressFields";
import { FormGrid, FormSubPanel } from "@/components/form";
import { useFieldError } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import { withForm } from "@/hooks/form";
import { ProofField } from "./ProofField";
import { SoldDocumentUpload } from "./SoldDocumentUpload";
import { emptyEscrow, emptyPolicy } from "./sold-deal-schema";

/**
 * The Discounts & Required Documentation card.
 *
 * The product value of the whole form: these selections are what generate the
 * post-sale audit items, so a discount ticked here becomes work on the service
 * team's hand-off board.
 *
 * Branches on the policy type. The two halves are mutually exclusive by
 * construction — `isAutoPolicyType` and `isPropertyPolicyType` are disjoint —
 * and the server **rejects** a cross-branch selection rather than stripping it,
 * so a Home policy can never conjure an auto audit item.
 */
export const DiscountsCard = withForm({
  defaultValues: emptyPolicy(),
  props: {
    uploadScope: { kind: "lead", leadId: "" } as UploadScope,
    contacts: [] as SoldHouseholdContact[],
  },
  render: function Render({ form, uploadScope, contacts }) {
    const policyType = useStore(form.store, (s) => s.values.policyType);

    const isProperty = isPropertyPolicyType(policyType);
    const isAuto = isAutoPolicyType(policyType);

    return (
      <div className="space-y-5">
        <PriorInsuranceDiscountField form={form} />

        {isProperty && <PropertyDiscounts form={form} uploadScope={uploadScope} />}
        {isAuto && (
          <AutoDiscounts form={form} uploadScope={uploadScope} contacts={contacts} />
        )}
        {/*
          * A sibling, not an early return: PAC-65 added a discount that applies
          * to every policy type, so Umbrella / Life / Boat Owners / Valuable
          * Item Protection are no longer cards with nothing on them.
          */}
        {!isProperty && !isAuto && (
          <p className="text-sm text-muted-foreground">
            No other discounts apply to a {policyType} policy.
          </p>
        )}
      </div>
    );
  },
});

/**
 * "The client has prior insurance" — every policy type (PAC-65 #15).
 *
 * Outside the property/auto split because prior coverage is not a property of
 * the line sold. Public records do not always show existing coverage, so the
 * producer keys it in by hand; ticking this generates the `Prior Insurance`
 * audit item and makes the prior-insurance card mandatory downstream.
 *
 * Un-ticking does **not** clear `priorInsurance.none` back on: the producer may
 * have legitimately set it, and silently re-answering a question on a card they
 * are not looking at is worse than leaving their answer alone.
 */
const PriorInsuranceDiscountField = withForm({
  defaultValues: emptyPolicy(),
  render: function Render({ form }) {
    return (
      <form.AppField name="discounts.priorInsuranceDiscount">
        {(f) => (
          <f.CheckboxField
            label="Prior insurance"
            hint="The client already had coverage. Requires the declarations page on the next card."
            onChanged={(on) => {
              // Ticking resolves the contradiction rather than leaving the
              // producer to walk forward into a disabled control and a
              // validation error explaining a card they have left behind.
              if (on) form.setFieldValue("priorInsurance.none", false);
            }}
          />
        )}
      </form.AppField>
    );
  },
});

/** Home / Renters / Condominium / Landlord. */
const PropertyDiscounts = withForm({
  defaultValues: emptyPolicy(),
  props: { uploadScope: { kind: "lead", leadId: "" } as UploadScope },
  render: function Render({ form, uploadScope }) {
    const escrow = useStore(form.store, (s) => s.values.discounts.escrow);

    return (
      <div className="space-y-5">
        <form.AppField name="discounts.escrow">
          {(f) => (
            <f.CheckboxField
              label="Escrow / mortgagee"
              hint="The lender pays the premium. Generates a mortgagee verification item."
              onChanged={(on) => {
                /*
                 * The details block lives and dies with the tick — the same
                 * cleanup `ProofField` does for its attachment, which this
                 * control was the only discount to be missing.
                 *
                 * Un-ticking used to leave a half-typed `escrow` object behind.
                 * `escrow` is `escrowSchema.optional()`, so a *present* object
                 * is validated whatever the checkbox says: the leftover failed
                 * on the fields the producer never filled, those fields were no
                 * longer rendered, and Continue went dead with nothing to read.
                 *
                 * Seeding a complete blank on the way in matters too — it is
                 * what makes the five "Required" messages land on the five
                 * inputs on screen instead of collapsing into one issue at the
                 * bare `escrow` root, which nothing is bound to.
                 */
                form.setFieldValue("escrow", on ? emptyEscrow() : undefined);
              }}
            />
          )}
        </form.AppField>

        {/*
          * Required *because* it was ticked: the audit item this generates asks
          * the service team to verify the loan number, company and address, which
          * is unanswerable without them.
          */}
        {escrow && (
          <FormSubPanel title="Escrow details" titleAs="h4">
            <form.AppField name="escrow.loanNumber">
              {(f) => <f.TextField label="Loan number" />}
            </form.AppField>
            <form.AppField name="escrow.companyName">
              {(f) => <f.TextField label="Escrow company" />}
            </form.AppField>
            {/*
              * Mounted only inside `{escrow && …}`. `escrow` is
              * `escrowSchema.optional()`, validated whenever the object is
              * *present* regardless of the checkbox, so a permanently-mounted
              * group would fight `emptyEscrow()` — the shape of the bug that
              * once jammed Continue with no message on screen.
              *
              * No `inputClassName`: the wizard deliberately does not use
              * `bg-card border-border`. No `shareToken` — this form is
              * authenticated-only.
              */}
            <AddressFields form={form} fields="escrow.address" gap={3} />
          </FormSubPanel>
        )}

        {/*
          * ⚠ There is deliberately no "Passed home inspection" control here.
          * PAC-56 #21 added one; PAC-65 removed it — David: there is no
          * document a producer can attach, and the item is *"only audit no
          * matter what"*. `Home Inspection` / `Landlord Inspection` are emitted
          * unconditionally from the policy type, so removing the checkbox
          * removed a control, not a requirement.
          */}
        <ProofField
          form={form}
          fields="discounts.fireSubscription"
          uploadScope={uploadScope}
          label="Fire subscription"
          proofPrompt="Attach proof of the fire subscription."
        />

        <ProofField
          form={form}
          fields="discounts.roofReceipt"
          uploadScope={uploadScope}
          label="New roof / hail resistant roof"
          proofPrompt="Attach the roof receipt or inspection."
        />

        <form.AppField name="discounts.acvPersonalProperty">
          {(f) => (
            <f.CheckboxField
              label="ACV — personal property"
              hint="Generates an actual-cash-value acknowledgement item."
            />
          )}
        </form.AppField>
        <form.AppField name="discounts.acvDwellingProtection">
          {(f) => (
            <f.CheckboxField
              label="ACV — dwelling protection"
              hint="Shares the one actual-cash-value item with the option above."
            />
          )}
        </form.AppField>
      </div>
    );
  },
});

/** Auto / Auto - Special / Motorcycle. */
const AutoDiscounts = withForm({
  defaultValues: emptyPolicy(),
  props: {
    uploadScope: { kind: "lead", leadId: "" } as UploadScope,
    contacts: [] as SoldHouseholdContact[],
  },
  render: function Render({ form, uploadScope, contacts }) {
    const defensiveDriver = useStore(
      form.store,
      (s) => s.values.discounts.defensiveDriver.selected,
    );

    return (
      <div className="space-y-5">
        {/*
          * ⚠ Back to a bare checkbox in PAC-65, and the **only** option on this
          * card that generates no audit item. Drivewise is a phone app that
          * monitors driving — there is no document that could prove enrolment,
          * so both the upload (#21) and the item (#21b) came out. The service
          * department works it from the renewal.
          */}
        <form.AppField name="discounts.drivewise">
          {(f) => (
            <f.CheckboxField
              label="Drivewise"
              hint="Recorded on the policy. Generates no audit item."
            />
          )}
        </form.AppField>

        <form.AppField name="discounts.defensiveDriver.selected">
          {(f) => (
            <f.CheckboxField
              label="Defensive driver"
              hint="One certificate item is generated per driver named below."
            />
          )}
        </form.AppField>

        {defensiveDriver && (
          <form.Field name="discounts.defensiveDriver.drivers" mode="array">
            {(drivers) => (
              <FormSubPanel title="Which drivers?" titleAs="h4">
                {contacts.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {contacts.map((contact) => {
                      const name =
                        `${contact.firstName} ${contact.lastName}`.trim();
                      const already = drivers.state.value.some(
                        (driver) => driver.name === name,
                      );
                      return (
                        <Button
                          key={contact.id}
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={already}
                          onClick={() =>
                            drivers.pushValue({ name, contactId: contact.id })
                          }
                        >
                          <Plus size={13} />
                          {name || "Unnamed"}
                        </Button>
                      );
                    })}
                  </div>
                )}

                {/*
                  * Free text alongside the picker: the spec calls for a sub-card to
                  * add drivers the household does not list yet, and a producer should
                  * not have to leave the sale to record one.
                  */}
                {drivers.state.value.map((_, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex items-end gap-2">
                      <form.AppField
                        name={`discounts.defensiveDriver.drivers[${index}].name`}
                      >
                        {(f) => (
                          <f.TextField
                            label={`Driver ${index + 1}`}
                            placeholder="Full name"
                            className="flex-1"
                          />
                        )}
                      </form.AppField>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => drivers.removeValue(index)}
                        aria-label={`Remove driver ${index + 1}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                    {/*
                      * Per driver, not one for the group: the certificates are
                      * per person, and the audit generator already fans out one
                      * item per name. Optional since PAC-65 — naming the driver
                      * is what is required.
                      */}
                    <DriverCertificateField
                      form={form}
                      uploadScope={uploadScope}
                      index={index}
                    />
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => drivers.pushValue({ name: "" })}
                >
                  <Plus size={14} />
                  Add a driver
                </Button>

                {/*
                  * The array-level "Add at least one driver." rule, which zod
                  * reports against the array itself rather than any one row.
                  * Gated on touched like every other message, so it appears when
                  * Continue is pressed — not the moment the toggle is ticked.
                  */}
                <ArrayMessage meta={drivers.state.meta} />
              </FormSubPanel>
            )}
          </form.Field>
        )}

        <ProofField
          form={form}
          fields="discounts.studentDiscount"
          uploadScope={uploadScope}
          label="Good student / student away from home"
          proofPrompt="Attach the report card or transcript."
        />
      </div>
    );
  },
});

/**
 * One driver's defensive-driver certificate. Optional since PAC-65.
 *
 * Per driver rather than one for the group: the certificates are issued per
 * person, and `computeRequiredTitles` already fans out one audit item per name,
 * so they map 1:1 onto what the service team will be chasing.
 */
const DriverCertificateField = withForm({
  defaultValues: emptyPolicy(),
  props: { uploadScope: { kind: "lead", leadId: "" } as UploadScope, index: 0 },
  render: function Render({ form, uploadScope, index }) {
    return (
      <form.Field
        name={`discounts.defensiveDriver.drivers[${index}].attachment`}
      >
        {(field) => (
          <SoldDocumentUpload
            uploadScope={uploadScope}
            value={field.state.value}
            onChange={(meta) => {
              field.handleChange(meta);
              field.handleBlur();
            }}
            ariaLabel={`Upload the certificate for driver ${index + 1}`}
            hint="Their defensive-driver certificate, if you have it. PDF, JPEG or PNG."
            error={useFieldError(field.state.meta)}
          />
        )}
      </form.Field>
    );
  },
});

function ArrayMessage({
  meta,
}: {
  meta: { errors: unknown[]; isTouched: boolean };
}) {
  const error = useFieldError(meta);
  return error ? <p className="text-sm text-destructive">{error}</p> : null;
}
