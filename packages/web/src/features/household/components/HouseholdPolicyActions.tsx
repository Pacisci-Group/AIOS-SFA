import type { PolicySummary } from "@sfa/shared";
import { ModuleKey } from "@sfa/shared";
import { RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/usePermissions";
import { EditHouseholdPolicyDialog } from "./EditHouseholdPolicyDialog";
import { StartCompanyTransferDialog } from "./StartCompanyTransferDialog";

interface HouseholdPolicyActionsProps {
  householdId: string;
  policy: PolicySummary;
}

/**
 * Everything a service rep can do to one policy from the household page
 * (PAC-126).
 *
 * Three actions, and which of them appear says a lot about who is looking:
 *
 *   - **Edit** — always, for anyone who can write the household. Corrections to
 *     what is on file.
 *   - **Cancel & rewrite** — `deal_audits:write`, because the replacement is a
 *     real sale and the flow books a deal, its policies and the audit hand-off.
 *   - **Company transfer** — `crm_service:write`, because it is booked on a
 *     service ticket and counts as no production at all.
 *
 * The two write flows are **complementary, not alternatives**: a CSR holds
 * `crm_service` and no `deal_audits`, a producer the other way round, so most
 * people see exactly one of them. That is the point — the two differ in what
 * happens to the money, and the person whose money it is should be the one who
 * can record it.
 *
 * Both are offered only on an **active** policy, matching the server: a rewrite
 * of an inactive policy 409s, and a transfer from one has nothing to retire. An
 * inactive policy has usually already been replaced, in which case the policy
 * page's history card names the replacement to work on instead.
 */
export function HouseholdPolicyActions({
  householdId,
  policy,
}: HouseholdPolicyActionsProps) {
  const { canWrite } = usePermissions();

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {policy.active && (
        <StartCompanyTransferDialog
          householdId={householdId}
          policy={policy}
          canTransfer={canWrite(ModuleKey.CrmService)}
        />
      )}

      {policy.active && canWrite(ModuleKey.DealAudits) && (
        <Button asChild variant="outline" size="sm">
          <Link
            to={`/sold/new?rewritePolicyId=${policy.id}`}
            aria-label={`Cancel and rewrite ${policy.policyNumber ?? policy.policyType ?? "policy"}`}
          >
            <RefreshCw aria-hidden className="size-4" />
            Cancel &amp; rewrite
          </Link>
        </Button>
      )}

      <EditHouseholdPolicyDialog householdId={householdId} policy={policy} />
    </div>
  );
}
