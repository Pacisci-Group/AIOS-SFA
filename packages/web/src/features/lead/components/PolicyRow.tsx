import type { LeadDetailPolicy } from "@sfa/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCurrency } from "./lead-display";

/**
 * One bound policy, as both the Household card and the Sold card render it
 * (PAC-56 #26, #27).
 *
 * Shared rather than duplicated because the two cards show the *same records*
 * from different angles — the Sold card is the deal's subset of the household's
 * policies — and a producer comparing them would notice the moment they
 * diverged.
 *
 * David asked for **policy number, policy type and carrier**; the card
 * previously showed type and carrier run together in a sentence, and no number
 * at all. Status is ours, not his.
 *
 * Layout is what makes it scannable: type and carrier lead, the number sits
 * under them in a monospace face (it is a code, and proportional digits make
 * two similar numbers hard to tell apart), status and premium sit right.
 */
export function PolicyRow({ policy }: { policy: LeadDetailPolicy }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
      <div className="min-w-0">
        <p className="truncate text-base font-medium text-card-foreground">
          {policy.policyType || "Policy"}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {policy.carrier ?? "Carrier not recorded"}
        </p>
        <p className="mt-0.5 truncate font-mono text-sm tabular-nums text-muted-foreground">
          {policy.policyNumber ?? "No policy number"}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <PolicyStatus policy={policy} />
        {policy.premium > 0 && (
          <p className="mt-1 text-base tabular-nums text-card-foreground">
            {formatCurrency(policy.premium)}
            <span className="text-sm text-muted-foreground">/yr</span>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Active is the state worth spotting, so the **colour** comes from `active` —
 * but the **text** prefers `status` whenever there is one.
 *
 * Those are two different questions and the first version conflated them: it
 * read `active ? "Active" : status`, so a stored status was only ever shown on
 * an inactive policy. That made the status field on the edit dialog (PAC-56
 * #27) write-only — a producer could save "Active — renewal pending" and the
 * card would keep flatly saying "Active". Found by running the pipeline.
 *
 * `status` is free text from the migration, rendered as-is rather than mapped,
 * because there is no canonical vocabulary to map it to.
 */
function PolicyStatus({ policy }: { policy: LeadDetailPolicy }) {
  const label = policy.status ?? (policy.active ? "Active" : "Inactive");

  return (
    <Badge
      size="sm"
      className={cn(
        "font-semibold",
        policy.active
          ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-500"
          : "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </Badge>
  );
}
