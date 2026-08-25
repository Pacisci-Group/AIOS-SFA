import type { QuoteRecapPropertyAddress } from "@sfa/shared";
import { premiumTermLabel } from "@sfa/shared";
import { useStore } from "@tanstack/react-form";
import { PolicyFields } from "@/components/policies/PolicyFields";
import { PolicySheet } from "@/components/policies/PolicySheet";
import { useAppForm } from "@/hooks/form";
import {
  quotedPolicySchema,
  type QuotedPolicyFormValues,
} from "./quote-recap-schema";

interface QuoteRecapPolicySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row being edited, or a blank one when adding. */
  initial: QuotedPolicyFormValues;
  isEdit: boolean;
  /** The household's stored address, or `null` when nothing is on file. */
  householdAddress: QuoteRecapPropertyAddress | null;
  onSave: (policy: QuotedPolicyFormValues) => void;
}

/**
 * The Add/Edit Policy drawer for the Quote Recap form (PAC-56 #15).
 *
 * The New Lead twin plus a premium field, composed in through `PolicyFields`'
 * `children` slot rather than flag-gated: the New Lead schema has no premium at
 * all, so a shared component declaring one would not typecheck there.
 *
 * Holds its own form for the reasons given on `LeadPolicySheet` — cancelling
 * must leave the recap untouched, and a half-typed policy must not make the
 * recap invalid while the producer is still filling it in.
 */
export function QuoteRecapPolicySheet({
  open,
  onOpenChange,
  initial,
  isEdit,
  householdAddress,
  onSave,
}: QuoteRecapPolicySheetProps) {
  const form = useAppForm({
    defaultValues: initial,
    validators: { onBlur: quotedPolicySchema },
    onSubmit: ({ value }) => {
      onSave(value);
      onOpenChange(false);
    },
  });

  // Subscribed rather than read off `initial`: the type is editable in this
  // sheet, so the premium's term has to follow the pending choice — picking
  // Auto must relabel the box before the number is typed into it.
  const policyType = useStore(form.store, (st) => st.values.policyType);

  return (
    <PolicySheet
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit policy" : "Add policy"}
      description="What was quoted, and — for a property policy — which address it insures."
      saveLabel={isEdit ? "Save changes" : "Add policy"}
      onSave={() => void form.handleSubmit()}
    >
      <form.AppForm>
        <PolicyFields
          form={form}
          fields={{
            policyType: "policyType",
            itemCount: "itemCount",
            sameAsHousehold: "sameAsHousehold",
            propertyAddress: "propertyAddress",
          }}
          householdAddress={householdAddress}
          // Quote Recap is authenticated-only — there is no public variant of
          // this form — so address lookup uses the normal endpoint (PAC-60).
          shareToken={undefined}
        >
          <form.AppField name="premium">
            {(f) => (
              <f.NumberField
                label={`${premiumTermLabel(policyType)} ($)`}
                step="0.01"
                min="0"
                className="sm:col-span-2"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
        </PolicyFields>
      </form.AppForm>
    </PolicySheet>
  );
}
