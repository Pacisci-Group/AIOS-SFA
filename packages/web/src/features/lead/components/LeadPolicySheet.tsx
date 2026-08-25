import type { QuoteRecapPropertyAddress } from "@sfa/shared";
import { PolicyFields } from "@/components/policies/PolicyFields";
import { PolicySheet } from "@/components/policies/PolicySheet";
import { useAppForm } from "@/hooks/form";
import {
  policyOfInterestSchema,
  type LeadPolicyFormValues,
} from "./lead-intake-schema";

interface LeadPolicySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row being edited, or a blank one when adding. */
  initial: LeadPolicyFormValues;
  isEdit: boolean;
  /** Memoized by the caller — {@link PolicyFields} copies it in an effect. */
  householdAddress: QuoteRecapPropertyAddress | null;
  /** Share-link token on the public intake form; omitted = authenticated (PAC-60). */
  shareToken?: string;
  onSave: (policy: LeadPolicyFormValues) => void;
}

/**
 * The Add/Edit Policy drawer for the New Lead form (PAC-56 #15).
 *
 * Holds its **own** form, not a slice of the intake form's. Two reasons:
 * cancelling has to leave the page untouched — a draft written straight into
 * the array would survive the drawer closing — and a half-filled policy must
 * not make the intake form invalid while it is being typed. The committed row
 * only reaches the parent through `onSave`, after this schema has passed.
 *
 * `defaultValues` are read once at mount, so the caller mounts this only while
 * the drawer is open (and keyed by which row it is editing). That is what makes
 * "edit policy 2" show policy 2 rather than whatever was open first.
 */
export function LeadPolicySheet({
  open,
  onOpenChange,
  initial,
  isEdit,
  householdAddress,
  shareToken,
  onSave,
}: LeadPolicySheetProps) {
  const form = useAppForm({
    defaultValues: initial,
    validators: { onBlur: policyOfInterestSchema },
    onSubmit: ({ value }) => {
      onSave(value);
      onOpenChange(false);
    },
  });

  return (
    <PolicySheet
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit policy" : "Add policy"}
      description="What would you like quoted, and — for a property policy — which address?"
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
          shareToken={shareToken}
        />
      </form.AppForm>
    </PolicySheet>
  );
}
