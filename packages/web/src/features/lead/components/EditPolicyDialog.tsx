import type { LeadDetailPolicy } from "@sfa/shared";
import { ModuleKey } from "@sfa/shared";
import { PolicyEditDialog } from "@/features/policy/components/PolicyEditDialog";
import { toPolicyFormValues } from "@/features/policy/components/policy-schema";
import { usePermissions } from "@/hooks/usePermissions";
import { useUpdatePolicy } from "./useUpdatePolicy";

interface EditPolicyDialogProps {
  leadId: string;
  policy: LeadDetailPolicy;
}

/**
 * The Sold card's quick edit (PAC-56 #27).
 *
 * David asked for the Sold card to allow "quick edits to sold policies". Legacy
 * had this as a whole second Fillout form (the Deals `Edit Sold` formula); this
 * is deliberately narrower — the fields a producer gets wrong at the keyboard.
 * Re-running the whole wizard to fix a transposed policy number would also
 * re-generate the audit hand-off.
 *
 * The form itself is `PolicyEditDialog`, shared with the household policy card
 * since PAC-126. What stays here is everything that is specific to *this* card:
 * the permission, the wording, and which cache the saved row is written back to.
 *
 * Gated on **`deal_audits:write`**, the same permission the Sold form itself
 * requires: correcting what that form wrote is the same act as writing it. The
 * household card deliberately answers that question differently — a CSR holds no
 * `deal_audits` permission at all — which is why the gate is a prop.
 */
export function EditPolicyDialog({ leadId, policy }: EditPolicyDialogProps) {
  const { canWrite } = usePermissions();
  const mutation = useUpdatePolicy(leadId, policy.id);

  const label = policy.policyNumber
    ? `${policy.policyType} ${policy.policyNumber}`
    : policy.policyType;

  return (
    <PolicyEditDialog
      record={policy}
      toValues={toPolicyFormValues}
      label={label}
      title="Edit sold policy"
      description="Corrections to what was recorded at sale. This does not re-run the sold form or regenerate the service hand-off."
      canEdit={canWrite(ModuleKey.DealAudits)}
      isPending={mutation.isPending}
      onSave={mutation.mutateAsync}
    />
  );
}
