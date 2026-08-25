import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Circle,
  Loader2,
  Lock,
  PhoneCall,
  ShoppingCart,
} from "lucide-react";
import { RENEWAL_OUTCOME_LABELS, premiumTermSuffix } from "@sfa/shared";
import {
  getRenewalCycle,
  type RenewalOutcome,
  type RenewalStepKey,
  type RenewalStepRef,
} from "@/lib/service-tickets-api";

interface RenewalPanelProps {
  step: RenewalStepRef;
  canWrite: boolean;
  isMutating?: boolean;
  onTogglePolicy: (policyId: string, discussed: boolean) => void;
  onCompleteStep: (stepKey: RenewalStepKey, outcome?: RenewalOutcome) => void;
  onChangeOutcome: (outcome: RenewalOutcome) => void;
}

/**
 * The renewal-outreach panel on a ticket.
 *
 * One call covers a whole deal, so the centrepiece is the **policy checklist**:
 * every policy renewing in this cycle, ticked off as it is discussed. The call
 * cannot be completed until all of them are — that rule lives on the server;
 * this only avoids offering an action that would 400.
 *
 * All timing decisions — whether the call can be made, whether it is overdue —
 * arrive from the server as booleans. Nothing here compares dates.
 */
export function RenewalPanel({
  step,
  canWrite,
  isMutating,
  onTogglePolicy,
  onCompleteStep,
  onChangeOutcome,
}: RenewalPanelProps) {
  const [outcome, setOutcome] = useState<RenewalOutcome | null>(null);

  // Keyed by cycle id so ticking a policy on one call refreshes the other.
  const cycleQuery = useQuery({
    queryKey: ["renewal-cycle", step.renewalCycleId],
    queryFn: () => getRenewalCycle(step.renewalCycleId),
  });
  const cycle = cycleQuery.data;

  const policies = cycle?.policies ?? [];
  const allDiscussed = policies.length > 0 && policies.every((p) => p.discussedAt);
  const needsOutcome = step.requiresOutcome && !step.completedAt;
  const canComplete =
    canWrite &&
    step.isActionable &&
    !isMutating &&
    allDiscussed &&
    (!needsOutcome || outcome !== null);

  const state = step.completedAt
    ? "done"
    : step.isOverdue
      ? "overdue"
      : step.isActionable
        ? "actionable"
        : "scheduled";

  const stateConfig = {
    done: { icon: CheckCircle2, color: "text-[var(--kpi-green)]", wrap: "bg-[var(--kpi-green)]/10" },
    overdue: { icon: AlertTriangle, color: "text-[#EF4444]", wrap: "bg-[#EF4444]/10" },
    actionable: { icon: PhoneCall, color: "text-[#0076A8]", wrap: "bg-[#0076A8]/10" },
    scheduled: { icon: Lock, color: "text-muted-foreground", wrap: "bg-white/5" },
  }[state];
  const StateIcon = stateConfig.icon;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      {/* Header: which call, and where it sits */}
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${stateConfig.wrap}`}>
          <StateIcon className={`w-4 h-4 ${stateConfig.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{step.label}</h3>
            <span className="text-[10px] text-muted-foreground">
              Step {step.sequence} of {step.totalSteps}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {step.daysUntilRenewal >= 0
              ? `Policy renews in ${step.daysUntilRenewal} day${step.daysUntilRenewal === 1 ? "" : "s"}`
              : `Policy renewed ${Math.abs(step.daysUntilRenewal)} day${Math.abs(step.daysUntilRenewal) === 1 ? "" : "s"} ago`}
            {step.mergedFrom.length > 0 && " · annual review merged into this call"}
          </p>
        </div>
      </div>

      {/* Policy checklist — the point of the panel */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-foreground">Policies on this renewal</span>
          <span className="text-[10px] text-muted-foreground">
            {policies.filter((p) => p.discussedAt).length} of {policies.length} discussed
          </span>
        </div>

        {cycleQuery.isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 size={12} className="animate-spin" />
            Loading policies…
          </div>
        )}

        <div className="space-y-1">
          {policies.map((policy) => {
            const discussed = Boolean(policy.discussedAt);
            return (
              <button
                key={policy.policyId}
                disabled={!canWrite || Boolean(step.completedAt) || isMutating}
                onClick={() => onTogglePolicy(policy.policyId, !discussed)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-secondary/40 hover:bg-secondary/70 disabled:hover:bg-secondary/40 disabled:cursor-not-allowed transition-colors text-left"
              >
                {discussed ? (
                  <CheckCircle2 className="w-4 h-4 text-[var(--kpi-green)] flex-shrink-0" />
                ) : (
                  <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground">
                    {policy.policyType}
                    <span className="text-muted-foreground font-normal font-mono ml-2">
                      {policy.policyNumber}
                    </span>
                  </div>
                  {policy.carrier && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {policy.carrier}
                      {policy.premium > 0 &&
                        ` · $${policy.premium.toLocaleString()}${premiumTermSuffix(policy.policyType)}`}
                    </div>
                  )}
                </div>
                {discussed && policy.discussedByName && (
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">
                    {policy.discussedByName}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {!allDiscussed && !step.completedAt && policies.length > 0 && (
          <p className="text-[10px] text-muted-foreground mt-2">
            Tick every policy as you cover it — the call cannot be closed until all are discussed.
          </p>
        )}
      </div>

      {/* Outcome — only on the renewal review, on both tracks */}
      {step.requiresOutcome && (
        <div>
          <span className="text-xs font-semibold text-foreground">Renewal decision</span>
          {step.completedAt && step.outcome ? (
            <div className="flex items-center gap-2 mt-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${
                  step.outcome === "took_renewal"
                    ? "bg-[var(--kpi-green)]/10 text-[var(--kpi-green)]"
                    : "bg-[#F59E0B]/10 text-[#F59E0B]"
                }`}
              >
                {step.outcome === "took_renewal" ? (
                  <CheckCircle2 size={12} />
                ) : (
                  <ShoppingCart size={12} />
                )}
                {RENEWAL_OUTCOME_LABELS[step.outcome]}
              </span>
              {canWrite && (
                <button
                  disabled={isMutating}
                  onClick={() =>
                    onChangeOutcome(
                      step.outcome === "took_renewal" ? "shopping" : "took_renewal",
                    )
                  }
                  className="text-[10px] text-muted-foreground hover:text-foreground underline disabled:opacity-40"
                >
                  Change
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 mt-2">
              {(["took_renewal", "shopping"] as const).map((option) => (
                <button
                  key={option}
                  disabled={!canWrite || !step.isActionable || isMutating}
                  onClick={() => setOutcome(option)}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    outcome === option
                      ? option === "took_renewal"
                        ? "bg-[var(--kpi-green)]/15 border-[var(--kpi-green)]/40 text-[var(--kpi-green)]"
                        : "bg-[#F59E0B]/15 border-[#F59E0B]/40 text-[#F59E0B]"
                      : "bg-secondary border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {option === "took_renewal" ? <CheckCircle2 size={12} /> : <ShoppingCart size={12} />}
                  {RENEWAL_OUTCOME_LABELS[option]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Complete */}
      {!step.completedAt && (
        <button
          disabled={!canComplete}
          onClick={() => onCompleteStep(step.stepKey, outcome ?? undefined)}
          title={
            !canWrite
              ? "You do not have write access"
              : !step.isActionable
                ? "This call has not opened yet"
                : !allDiscussed
                  ? "Tick every policy first"
                  : needsOutcome && !outcome
                    ? "Record the renewal decision first"
                    : undefined
          }
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#0076A8] text-xs font-semibold text-white hover:bg-[#0076A8]/85 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isMutating ? <Loader2 size={13} className="animate-spin" /> : <PhoneCall size={13} />}
          Complete {step.label}
        </button>
      )}

      {/* Chain: both calls, or the single merged one */}
      {cycle && (
        <div className="pt-3 border-t border-border">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            Outreach
          </span>
          <ol className="mt-2 space-y-1.5">
            {cycle.chain.map((link) => (
              <li key={link.stepKey} className="flex items-center gap-2 text-xs">
                {link.completedAt ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[var(--kpi-green)] flex-shrink-0" />
                ) : link.isOverdue ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-[#EF4444] flex-shrink-0" />
                ) : link.isActionable ? (
                  <PhoneCall className="w-3.5 h-3.5 text-[#0076A8] flex-shrink-0" />
                ) : (
                  <CalendarClock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                )}
                <span
                  className={
                    link.stepKey === step.stepKey
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  {link.label}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {link.completedAt
                    ? "done"
                    : link.ticketId
                      ? link.isActionable
                        ? "open"
                        : "scheduled"
                      : "not scheduled"}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
