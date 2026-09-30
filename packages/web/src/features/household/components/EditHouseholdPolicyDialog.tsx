import type { PolicySummary } from "@sfa/shared";
import { ModuleKey } from "@sfa/shared";
import { PolicyEditDialog } from "@/features/policy/components/PolicyEditDialog";
import { toPolicyFormValuesFromSummary } from "@/features/policy/components/policy-schema";
import { usePermissions } from "@/hooks/usePermissions";
import { useUpdateHouseholdPolicy } from "./useUpdateHouseholdPolicy";

interface EditHouseholdPolicyDialogProps {
  householdId: string;
  policy: PolicySummary;
}

/**
 * The household policy card's edit (PAC-126).
 *
 * David, opening a household on production: *"we need to have an update of
 * expiration date because I see it doesn't have expiration date here … we need
 * to fix that."* Most migrated policies came across with no effective date at
 * all, so there was nothing to derive a renewal from and the card had nothing to
 * show. This is how the service team puts it right, one policy at a time.
 *
 * Shares its form with the Lead Detail Sold card (`PolicyEditDialog`) and
 * differs in the three things that are genuinely local: the endpoint, the cache
 * it writes back to, and the permission.
 *
 * ## The permission is an OR, unlike the Sold card's
 *
 * `clients:write` **or** `crm_service:write`, matching the endpoint. A CSR — the
 * service rep this feature exists for — holds no `clients` permission at all;
 * gating on `clients:write` alone would hide the button from exactly the person
 * David asked to give it to, while `crm_service:*` is already what lets them
 * open the household in the first place.
 */
export function EditHouseholdPolicyDialog({
  householdId,
  policy,
}: EditHouseholdPolicyDialogProps) {
  const { canWrite } = usePermissions();
  const mutation = useUpdateHouseholdPolicy(householdId, policy.id);

  const label = policy.policyNumber
    ? `${policy.policyType ?? "policy"} ${policy.policyNumber}`
    : (policy.policyType ?? "policy");

  return (
    <PolicyEditDialog
      record={policy}
      toValues={toPolicyFormValuesFromSummary}
      label={label}
      title="Edit policy"
      description="Corrections to what is on file. Setting the effective date is what gives the policy its renewal date."
      canEdit={canWrite(ModuleKey.Clients) || canWrite(ModuleKey.CrmService)}
      isPending={mutation.isPending}
      onSave={mutation.mutateAsync}
    />
  );
}
