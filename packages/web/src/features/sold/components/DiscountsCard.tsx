import type { SoldHouseholdContact } from "@sfa/shared";
import { isAutoPolicyType, isPropertyPolicyType } from "@sfa/shared";
import { useStore } from "@tanstack/react-form";
import { Plus, X } from "lucide-react";
import { FormGrid, FormSubPanel } from "@/components/form";
import { useFieldError } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import { withForm } from "@/hooks/form";
import { ProofField } from "./ProofField";
import { emptyPolicy } from "./sold-deal-schema";

/**
 * Card 5 — Discounts & Required Documentation.
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
  props: { leadId: "", contacts: [] as SoldHouseholdContact[] },
  render: function Render({ form, leadId, contacts }) {
    const policyType = useStore(form.store, (s) => s.values.policyType);

    const isProperty = isPropertyPolicyType(policyType);
    const isAuto = isAutoPolicyType(policyType);

    if (!isProperty && !isAuto) {
      return (
        <p className="text-sm text-muted-foreground">
          No discounts apply to a {policyType} policy. Continue to prior insurance.
        </p>
      );
    }

    return (
      <div className="space-y-5">
        {isProperty && <PropertyDiscounts form={form} leadId={leadId} />}
        {isAuto && (
          <AutoDiscounts form={form} leadId={leadId} contacts={contacts} />
        )}
      </div>
    );
  },
});

/** Written once as `[path, label]` pairs so each path is checked against the schema. */
const ESCROW_ADDRESS_FIELDS = [
  ["escrow.address.street", "Street"],
  ["escrow.address.city", "City"],
  ["escrow.address.state", "State"],
  ["escrow.address.zip", "ZIP"],
] as const;

/** Home / Renters / Condominium / Landlord. */
const PropertyDiscounts = withForm({
  defaultValues: emptyPolicy(),
  props: { leadId: "" },
  render: function Render({ form, leadId }) {
    const escrow = useStore(form.store, (s) => s.values.discounts.escrow);

    return (
      <div className="space-y-5">
        <form.AppField name="discounts.escrow">
          {(f) => (
            <f.CheckboxField
              label="Escrow / mortgagee"
              hint="The lender pays the premium. Generates a mortgagee verification item."
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
            <FormGrid gap={3}>
              {ESCROW_ADDRESS_FIELDS.map(([name, label]) => (
                <form.AppField key={name} name={name}>
                  {(f) => <f.TextField label={label} />}
                </form.AppField>
              ))}
            </FormGrid>
          </FormSubPanel>
        )}

        <ProofField
          form={form}
          fields="discounts.fireSubscription"
          leadId={leadId}
          label="Fire subscription"
          proofPrompt="Do you have proof of the fire subscription?"
        />

        <ProofField
          form={form}
          fields="discounts.roofReceipt"
          leadId={leadId}
          label="New roof / hail resistant roof"
          proofPrompt="Do you have the roof receipt?"
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
  props: { leadId: "", contacts: [] as SoldHouseholdContact[] },
  render: function Render({ form, leadId, contacts }) {
    const defensiveDriver = useStore(
      form.store,
      (s) => s.values.discounts.defensiveDriver.selected,
    );

    return (
      <div className="space-y-5">
        <form.AppField name="discounts.drivewise">
          {(f) => (
            <f.CheckboxField
              label="Drivewise"
              // Per the spec: unconditionally an audit item, with no proof prompt.
              hint="Always generates an item — service must mention registration."
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
                  <div key={index} className="flex items-end gap-2">
                    <form.AppField
                      name={`discounts.defensiveDriver.drivers[${index}].name`}
                    >
                      {(f) => (
                        <f.TextField
                          label={`Driver ${index + 1}`}
                          labelClassName="text-[10px] uppercase tracking-widest text-muted-foreground"
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
                      <X size={14} />
                    </Button>
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
          leadId={leadId}
          label="Good student / student away from home"
          proofPrompt="Do you have the report card or transcript?"
        />
      </div>
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
