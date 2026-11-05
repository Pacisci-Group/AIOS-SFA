import { Plane } from "lucide-react";
import { TIME_OFF_TYPE_LABELS, type TimeOffSummaryPolicy } from "@sfa/shared";
import { Button } from "@/components/ui/button";
import { formatBalance } from "@/features/hr/policies/time-off/time-off-display";
import { cn } from "@/lib/utils";

/**
 * The employee's cards (PAC-165): one per time off policy they are in,
 * with the two numbers that answer "how much can I take?".
 *
 * **Available hours** leads — the current balance less what is already
 * spoken for (approved leave not yet taken, requests still waiting). The
 * **current balance** sits under it so the difference explains itself.
 * An Unlimited policy has no numbers to show. The policy is chosen by the
 * card whose button is pressed, as in Gusto.
 */
export function PolicyCards({
  policies,
  onRequest,
}: {
  policies: readonly TimeOffSummaryPolicy[];
  onRequest: (policy: TimeOffSummaryPolicy) => void;
}) {
  if (policies.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-5 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          You are not in a time off policy yet. An HR admin adds you from your profile.
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {policies.map((policy) => (
        <section
          key={policy.id}
          className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5"
        >
          <header className="flex items-start gap-3">
            <Plane aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-card-foreground">
                {policy.name}
              </h2>
              <p className="text-xs text-muted-foreground">
                {TIME_OFF_TYPE_LABELS[policy.timeOffType]}
              </p>
            </div>
          </header>

          {policy.unlimited ? (
            <p className="text-2xl font-semibold tracking-tight text-foreground">Unlimited</p>
          ) : (
            <div>
              <p
                className={cn(
                  "text-2xl font-semibold tracking-tight tabular-nums",
                  (policy.availableHours ?? 0) < 0 ? "text-destructive" : "text-foreground",
                )}
              >
                {formatBalance(policy.availableHours ?? 0)}
              </p>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Available
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Current balance {formatBalance(policy.currentBalance ?? 0)}
                {(policy.otherRequestedHours ?? 0) > 0
                  ? ` · ${formatBalance(policy.otherRequestedHours ?? 0)} requested`
                  : ""}
              </p>
            </div>
          )}

          <Button
            variant="brand"
            size="sm"
            className="mt-auto self-start"
            onClick={() => onRequest(policy)}
          >
            Request time off
          </Button>
        </section>
      ))}
    </div>
  );
}
