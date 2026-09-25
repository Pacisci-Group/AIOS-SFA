import type { PolicySummary } from "@sfa/shared";
import { ModuleKey } from "@sfa/shared";
import { PolicyReplacementActions } from "@/features/policy/components/PolicyReplacementActions";
import { usePermissions } from "@/hooks/usePermissions";
import { EditHouseholdPolicyDialog } from "./EditHouseholdPolicyDialog";

interface HouseholdPolicyActionsProps {
  householdId: string;
  policy: PolicySummary;
}

/**
 * Everything a service rep can do to one policy from the household page
 * (PAC-126).
 *
 * Three actions: **Edit** (corrections to what is on file), **Cancel &
 * rewrite**, and **Company transfer**. The two replacements differ only in what
 * happens to the money — a rewrite charges the premium back, a transfer moves a
 * client within their own book and charges nothing — and both take the same
 * route from here: New Lead → Sold form, with the policy retired, linked and
 * charged back when that second form is submitted.
 *
 * ## One permission for both, now
 *
 * `deal_audits:write`, because that is what the chain actually needs end to end:
 * the Sold form requires it, and the CRM role holds it. Until PAC-126 a transfer
 * was gated on `crm_service:write` instead because it was recorded on a ticket —
 * it is not any more, and gating it on a permission the flow no longer touches
 * would hide the button from people who can use it and show it to people who
 * cannot.
 *
 * Both are offered only on an **active** policy, matching the server: an
 * inactive one has usually already been replaced, in which case the policy
 * page's history card names the replacement to work on instead.
 */
export function HouseholdPolicyActions({
  householdId,
  policy,
}: HouseholdPolicyActionsProps) {
  const { canWrite } = usePermissions();
  const canReplace = policy.active && canWrite(ModuleKey.DealAudits);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canReplace && <PolicyReplacementActions policyId={policy.id} />}

      <EditHouseholdPolicyDialog householdId={householdId} policy={policy} />
    </div>
  );
}
