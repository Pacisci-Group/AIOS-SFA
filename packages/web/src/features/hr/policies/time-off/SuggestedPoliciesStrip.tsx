import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import {
  AgencyPermission,
  SUGGESTED_TIME_OFF_POLICIES,
  type HrPolicySummary,
} from "@sfa/shared";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/usePermissions";

/**
 * Gusto's "Suggested policies" strip (PAC-174): three common policies with
 * an Add button each. Clicking opens the wizard pre-filled at Step 1;
 * nothing is saved until Activate. Always shown — a second PTO policy for
 * another group of people is a normal thing to want — with a note when a
 * policy of that kind already exists.
 */
export function SuggestedPoliciesStrip({ policies }: { policies: readonly HrPolicySummary[] }) {
  const { can } = usePermissions();
  if (!can(AgencyPermission.HrAdmin)) return null;
  const countOf = (kind: string) =>
    policies.filter((p) => p.type === "time_off" && p.timeOff.timeOffType === kind).length;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-foreground">Suggested time off policies</h2>
        <p className="text-sm text-muted-foreground">
          Common starting points. Each opens the wizard filled in; change anything before you
          activate.
        </p>
      </div>
      <ul className="grid gap-3 md:grid-cols-3">
        {SUGGESTED_TIME_OFF_POLICIES.map((suggested) => {
          const existing = countOf(suggested.key);
          return (
            <li
              key={suggested.key}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="space-y-1">
                <p className="text-sm font-semibold text-card-foreground">{suggested.name}</p>
                <p className="text-sm text-muted-foreground">{suggested.summary}</p>
                {existing > 0 && (
                  <p className="text-xs text-muted-foreground">
                    You already have {existing} {existing === 1 ? "policy" : "policies"} of this kind.
                  </p>
                )}
              </div>
              <Button asChild variant="outline" size="sm" className="mt-auto w-full">
                <Link to={`/settings/hr-policies/new/time-off?type=${suggested.key}&preset=1`}>
                  <Plus />
                  Add policy
                </Link>
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
