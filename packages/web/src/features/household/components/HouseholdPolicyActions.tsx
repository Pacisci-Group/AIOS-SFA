import type { PolicySummary } from "@sfa/shared";
import { ModuleKey } from "@sfa/shared";
import { PolicyReplacementActions } from "@/features/policy/components/PolicyReplacementActions";
import { usePermissions } from "@/hooks/usePermissions";
import { CancelPolicyDialog } from "./CancelPolicyDialog";
import { EditHouseholdPolicyDialog } from "./EditHouseholdPolicyDialog";
import { isCancellablePolicy } from "./policy-display";

interface HouseholdPolicyActionsProps {
  householdId: string;
  policy: PolicySummary;
  /** After a cancellation is saved — the page asks about the address next. */
  onCancelled?: (policy: PolicySummary) => void;
}

/**
 * Everything a service rep can do to one policy from the household page
 * (PAC-126).
 *
 * Four actions: **Edit** (corrections to what is on file), **Cancel** (the
 * client left, and why), **Cancel & rewrite**, and **Company transfer**. The two
 * replacements differ only in what happens to the money — a rewrite charges the
 * premium back, a transfer moves a client within their own book and charges
 * nothing — and both take the same route from here: New Lead → Sold form, with
 * the policy retired, linked and charged back when that second form is
 * submitted. A plain cancel has nothing to replace, so it is one dialog.
 *
 * ## The permissions differ, and each matches its endpoint
 *
 * The replacements take `deal_audits:write`, because that is what the chain
 * actually needs end to end: the Sold form requires it, and the CRM role holds
 * it. Until PAC-126 a transfer was gated on `crm_service:write` instead because
 * it was recorded on a ticket — it is not any more, and gating it on a
 * permission the flow no longer touches would hide the button from people who
 * can use it and show it to people who cannot.
 *
 * Cancel takes `clients:write` **or** `crm_service:write`, like Edit: it is a
 * write on the household's policy, not on a sale, and the service team it is
 * for holds no `clients` permission.
 *
 * The replacements are offered only on an **active** policy, matching the
 * server: an inactive one has usually already been replaced, in which case the
 * policy page's history card names the replacement to work on instead. Cancel
 * is offered on an active or pending one — a client can back out before
 * coverage starts.
 */
export function HouseholdPolicyActions({
  householdId,
  policy,
  onCancelled,
}: HouseholdPolicyActionsProps) {
  const { canWrite } = usePermissions();
  const canReplace = policy.active && canWrite(ModuleKey.DealAudits);
  const canCancel =
    isCancellablePolicy(policy) &&
    (canWrite(ModuleKey.Clients) || canWrite(ModuleKey.CrmService));

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canReplace && <PolicyReplacementActions policyId={policy.id} />}

      {canCancel && (
        <CancelPolicyDialog
          householdId={householdId}
          policy={policy}
          onCancelled={onCancelled}
        />
      )}

      <EditHouseholdPolicyDialog householdId={householdId} policy={policy} />
    </div>
  );
}
