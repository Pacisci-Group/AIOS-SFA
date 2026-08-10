import type { SoldHouseholdContact } from "@sfa/shared";
import { isAutoPolicyType, isPropertyPolicyType } from "@sfa/shared";
import { Plus, X } from "lucide-react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ProofField } from "./ProofField";
import type { SoldPolicyFormValues } from "./sold-deal-schema";

interface DiscountsCardProps {
  leadId: string;
  /** Household members offered as defensive drivers. */
  contacts: SoldHouseholdContact[];
}

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
export function DiscountsCard({ leadId, contacts }: DiscountsCardProps) {
  const form = useFormContext<SoldPolicyFormValues>();
  const policyType = useWatch({ control: form.control, name: "policyType" });

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
      {isProperty && <PropertyDiscounts leadId={leadId} />}
      {isAuto && <AutoDiscounts leadId={leadId} contacts={contacts} />}
    </div>
  );
}

/** Home / Renters / Condominium / Landlord. */
function PropertyDiscounts({ leadId }: { leadId: string }) {
  const form = useFormContext<SoldPolicyFormValues>();
  const escrow = useWatch({ control: form.control, name: "discounts.escrow" });

  return (
    <div className="space-y-5">
      <DiscountToggle
        name="discounts.escrow"
        label="Escrow / mortgagee"
        hint="The lender pays the premium. Generates a mortgagee verification item."
      />

      {/*
        * Required *because* it was ticked: the audit item this generates asks
        * the service team to verify the loan number, company and address, which
        * is unanswerable without them.
        */}
      {escrow && (
        <div className="rounded-lg border border-border bg-background/40 p-3 space-y-3">
          <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Escrow details
          </h4>
          <FormField
            control={form.control}
            name="escrow.loanNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Loan number</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="escrow.companyName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Escrow company</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["escrow.address.street", "Street"],
                ["escrow.address.city", "City"],
                ["escrow.address.state", "State"],
                ["escrow.address.zip", "ZIP"],
              ] as const
            ).map(([name, label]) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          </div>
        </div>
      )}

      <ProofField
        leadId={leadId}
        name="discounts.fireSubscription"
        label="Fire subscription"
        proofPrompt="Do you have proof of the fire subscription?"
      />

      <ProofField
        leadId={leadId}
        name="discounts.roofReceipt"
        label="New roof / hail resistant roof"
        proofPrompt="Do you have the roof receipt?"
      />

      <DiscountToggle
        name="discounts.acvPersonalProperty"
        label="ACV — personal property"
        hint="Generates an actual-cash-value acknowledgement item."
      />
      <DiscountToggle
        name="discounts.acvDwellingProtection"
        label="ACV — dwelling protection"
        hint="Shares the one actual-cash-value item with the option above."
      />
    </div>
  );
}

/** Auto / Auto - Special / Motorcycle. */
function AutoDiscounts({
  leadId,
  contacts,
}: {
  leadId: string;
  contacts: SoldHouseholdContact[];
}) {
  const form = useFormContext<SoldPolicyFormValues>();
  const defensiveDriver = useWatch({
    control: form.control,
    name: "discounts.defensiveDriver.selected",
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "discounts.defensiveDriver.drivers",
  });

  return (
    <div className="space-y-5">
      <DiscountToggle
        name="discounts.drivewise"
        label="Drivewise"
        // Per the spec: unconditionally an audit item, with no proof prompt.
        hint="Always generates an item — service must mention registration."
      />

      <DiscountToggle
        name="discounts.defensiveDriver.selected"
        label="Defensive driver"
        hint="One certificate item is generated per driver named below."
      />

      {defensiveDriver && (
        <div className="rounded-lg border border-border bg-background/40 p-3 space-y-3">
          <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Which drivers?
          </h4>

          {contacts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {contacts.map((contact) => {
                const name = `${contact.firstName} ${contact.lastName}`.trim();
                const already = fields.some(
                  (f, i) =>
                    form.getValues(
                      `discounts.defensiveDriver.drivers.${i}.name`,
                    ) === name,
                );
                return (
                  <Button
                    key={contact.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={already}
                    onClick={() => append({ name, contactId: contact.id })}
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
          {fields.map((field, index) => (
            <div key={field.id} className="flex items-end gap-2">
              <FormField
                control={form.control}
                name={`discounts.defensiveDriver.drivers.${index}.name`}
                render={({ field: nameField }) => (
                  <FormItem className="flex-1">
                    <FormLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      Driver {index + 1}
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Full name" {...nameField} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => remove(index)}
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
            onClick={() => append({ name: "" })}
          >
            <Plus size={14} />
            Add a driver
          </Button>

          {form.formState.errors.discounts?.defensiveDriver?.drivers && (
            <p className="text-sm text-destructive">
              {form.formState.errors.discounts.defensiveDriver.drivers.message}
            </p>
          )}
        </div>
      )}

      <ProofField
        leadId={leadId}
        name="discounts.studentDiscount"
        label="Good student / student away from home"
        proofPrompt="Do you have the report card or transcript?"
      />
    </div>
  );
}

/** A plain on/off discount with no proof prompt. */
function DiscountToggle({
  name,
  label,
  hint,
}: {
  name:
    | "discounts.escrow"
    | "discounts.acvPersonalProperty"
    | "discounts.acvDwellingProtection"
    | "discounts.drivewise"
    | "discounts.defensiveDriver.selected";
  label: string;
  hint: string;
}) {
  const form = useFormContext<SoldPolicyFormValues>();
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="space-y-1">
          <div className="flex flex-row items-center gap-2 space-y-0">
            <FormControl>
              <Checkbox
                checked={Boolean(field.value)}
                onCheckedChange={(checked) => field.onChange(checked === true)}
              />
            </FormControl>
            <FormLabel className="font-normal">{label}</FormLabel>
          </div>
          <FormDescription>{hint}</FormDescription>
        </FormItem>
      )}
    />
  );
}
