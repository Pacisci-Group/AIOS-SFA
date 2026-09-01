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
  RefreshCw,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import { RENEWAL_OUTCOME_LABELS, premiumTermSuffix } from "@sfa/shared";
import { DetailCard, SectionLabel } from "@/components/common/DetailCard";
import { DisabledHint } from "@/components/common/DisabledHint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getRenewalCycle,
  type RenewalOutcome,
  type RenewalStepKey,
  type RenewalStepRef,
} from "@/lib/service-tickets-api";
import { cn } from "@/lib/utils";

interface RenewalPanelProps {
  step: RenewalStepRef;
  canWrite: boolean;
  isMutating?: boolean;
  onTogglePolicy: (policyId: string, discussed: boolean) => void;
  onCompleteStep: (stepKey: RenewalStepKey, outcome?: RenewalOutcome) => void;
  onChangeOutcome: (outcome: RenewalOutcome) => void;
}

type StepState = "done" | "overdue" | "actionable" | "scheduled";

const STATE_CONFIG: Record<
  StepState,
  { icon: LucideIcon; tone: string; tint: string }
> = {
  done: { icon: CheckCircle2, tone: "text-success", tint: "bg-success/12" },
  overdue: {
    icon: AlertTriangle,
    tone: "text-red-600 dark:text-red-400",
    tint: "bg-red-500/12",
  },
  actionable: { icon: PhoneCall, tone: "text-primary", tint: "bg-primary/12" },
  scheduled: {
    icon: Lock,
    tone: "text-muted-foreground",
    tint: "bg-muted",
  },
};

/** Stated in two places; kept as a constant so they cannot drift apart. */
const TICK_POLICIES_REASON = "Tick every policy first.";

/**
 * The two decisions a renewal review can end in, and how each one reads.
 *
 * ⚠ The `dark:bg-*` duplicates are **load-bearing, not redundant.** These tints
 * are applied over `Button variant="outline"`, whose own base carries
 * `dark:bg-input/30` / `dark:border-input`. `cn` is tailwind-merge: a
 * `dark:`-modified class of ours *replaces* the primitive's (same property, same
 * modifier), whereas an unmodified `bg-*` merely sits beside it — and loses in
 * dark, because `.dark\:bg-input\/30:is(.dark *)` is specificity (0,2,0) against
 * our (0,1,0). Without the pair, the selected outcome is indistinguishable from
 * the unselected one on the navy theme, which is the app's default.
 */
const OUTCOME_TONE: Record<RenewalOutcome, string> = {
  took_renewal: "bg-success/12 dark:bg-success/12 text-success",
  shopping:
    "bg-amber-500/15 dark:bg-amber-500/15 text-amber-700 dark:text-amber-500",
};

const OUTCOME_ICON: Record<RenewalOutcome, LucideIcon> = {
  took_renewal: CheckCircle2,
  shopping: ShoppingCart,
};

/** The recorded decision, once the review is closed. */
function OutcomeBadge({ outcome }: { outcome: RenewalOutcome }) {
  const Icon = OUTCOME_ICON[outcome];
  return (
    <Badge size="lg" variant="ghost" className={cn("gap-1.5", OUTCOME_TONE[outcome])}>
      <Icon aria-hidden />
      {RENEWAL_OUTCOME_LABELS[outcome]}
    </Badge>
  );
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

  const state: StepState = step.completedAt
    ? "done"
    : step.isOverdue
      ? "overdue"
      : step.isActionable
        ? "actionable"
        : "scheduled";

  const stateConfig = STATE_CONFIG[state];
  const StateIcon = stateConfig.icon;

  /** Why Complete is unavailable, or `undefined` when it is not. */
  const blockedReason = canComplete
    ? undefined
    : !canWrite
      ? "You do not have write access."
      : !step.isActionable
        ? "This call has not opened yet."
        : !allDiscussed
          ? TICK_POLICIES_REASON
          : needsOutcome && !outcome
            ? "Record the renewal decision first."
            : undefined;

  // The visible line under the button repeats every reason except the
  // tick-every-policy one, which the checklist already states right where the
  // ticking happens. Saying it twice on one card reads as nagging.
  const blockedNotice =
    blockedReason === TICK_POLICIES_REASON ? undefined : blockedReason;

  return (
    <DetailCard
      title="Renewal outreach"
      icon={RefreshCw}
      action={
        <span className="text-sm text-muted-foreground">
          Step {step.sequence} of {step.totalSteps}
        </span>
      }
    >
      <div className="space-y-5">
        {/* Header: which call, and where it sits */}
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              stateConfig.tint,
            )}
          >
            <StateIcon className={cn("size-4", stateConfig.tone)} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-medium text-card-foreground">
              {step.label}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {step.daysUntilRenewal >= 0
                ? `Policy renews in ${step.daysUntilRenewal} day${step.daysUntilRenewal === 1 ? "" : "s"}`
                : `Policy renewed ${Math.abs(step.daysUntilRenewal)} day${Math.abs(step.daysUntilRenewal) === 1 ? "" : "s"} ago`}
              {step.mergedFrom.length > 0 &&
                " · annual review merged into this call"}
            </p>
          </div>
        </div>

        {/* Policy checklist — the point of the panel */}
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <SectionLabel>Policies on this renewal</SectionLabel>
            <span className="text-sm tabular-nums text-muted-foreground">
              {policies.filter((p) => p.discussedAt).length} of {policies.length}{" "}
              discussed
            </span>
          </div>

          {cycleQuery.isPending && (
            <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Loading policies…
            </p>
          )}

          <div className="space-y-1">
            {policies.map((policy) => {
              const discussed = Boolean(policy.discussedAt);
              return (
                <button
                  key={policy.policyId}
                  type="button"
                  disabled={!canWrite || Boolean(step.completedAt) || isMutating}
                  onClick={() => onTogglePolicy(policy.policyId, !discussed)}
                  className="flex w-full items-center gap-2.5 rounded-md bg-sunken px-3 py-2 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:hover:bg-sunken"
                >
                  {discussed ? (
                    <CheckCircle2
                      aria-hidden
                      className="size-4 shrink-0 text-success"
                    />
                  ) : (
                    <Circle
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      {policy.policyType}
                      <span className="ml-2 font-normal tabular-nums text-muted-foreground">
                        {policy.policyNumber}
                      </span>
                    </span>
                    {policy.carrier && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {policy.carrier}
                        {policy.premium > 0 &&
                          ` · $${policy.premium.toLocaleString()}${premiumTermSuffix(policy.policyType)}`}
                      </span>
                    )}
                  </span>
                  {discussed && policy.discussedByName && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {policy.discussedByName}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {!allDiscussed && !step.completedAt && policies.length > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              Tick every policy as you cover it — the call cannot be closed until
              all are discussed.
            </p>
          )}
        </section>

        {/* Outcome — only on the renewal review, on both tracks */}
        {step.requiresOutcome && (
          <section>
            <SectionLabel className="mb-2">Renewal decision</SectionLabel>
            {step.completedAt && step.outcome ? (
              <div className="flex flex-wrap items-center gap-2">
                <OutcomeBadge outcome={step.outcome} />
                {canWrite && (
                  <Button
                    variant="link"
                    size="sm"
                    disabled={isMutating}
                    onClick={() =>
                      onChangeOutcome(
                        step.outcome === "took_renewal"
                          ? "shopping"
                          : "took_renewal",
                      )
                    }
                  >
                    Change
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {(["took_renewal", "shopping"] as const).map((option) => {
                  const Icon = OUTCOME_ICON[option];
                  const selected = outcome === option;
                  return (
                    <Button
                      key={option}
                      variant="outline"
                      size="sm"
                      disabled={!canWrite || !step.isActionable || isMutating}
                      onClick={() => setOutcome(option)}
                      aria-pressed={selected}
                      className={cn(
                        selected && [
                          OUTCOME_TONE[option],
                          // Paired for the same reason as the tints above:
                          // `outline` carries `dark:border-input`.
                          "border-current/40 dark:border-current/40",
                        ],
                      )}
                    >
                      <Icon />
                      {RENEWAL_OUTCOME_LABELS[option]}
                    </Button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Complete */}
        {!step.completedAt && (
          <div>
            {/* The hint has to sit on a wrapper: `Button` is
                `disabled:pointer-events-none`, so a `title` on it is never
                hovered — and this is the only place the blocking reason is
                surfaced at all. See `DisabledHint`. */}
            <DisabledHint className="w-full" hint={blockedReason}>
              <Button
                className="w-full"
                disabled={!canComplete}
                onClick={() => onCompleteStep(step.stepKey, outcome ?? undefined)}
              >
                {isMutating ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <PhoneCall />
                )}
                Complete {step.label}
              </Button>
            </DisabledHint>
            {/* Said in visible copy as well as the tooltip: a hover hint never
                reaches a keyboard or screen-reader user, and a Complete button
                that refuses without saying why is the whole complaint. */}
            {blockedNotice && (
              <p className="mt-2 text-sm text-muted-foreground">
                {blockedNotice}
              </p>
            )}
          </div>
        )}

        {/* Chain: both calls, or the single merged one */}
        {cycle && (
          <section className="border-t border-border pt-4">
            <SectionLabel className="mb-2">Outreach</SectionLabel>
            <ol className="space-y-1.5">
              {cycle.chain.map((link) => (
                <li
                  key={link.stepKey}
                  className="flex items-center gap-2 text-sm"
                >
                  {link.completedAt ? (
                    <CheckCircle2
                      aria-hidden
                      className="size-4 shrink-0 text-success"
                    />
                  ) : link.isOverdue ? (
                    <AlertTriangle
                      aria-hidden
                      className="size-4 shrink-0 text-red-600 dark:text-red-400"
                    />
                  ) : link.isActionable ? (
                    <PhoneCall
                      aria-hidden
                      className="size-4 shrink-0 text-primary"
                    />
                  ) : (
                    <CalendarClock
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
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
                  <span className="ml-auto text-xs text-muted-foreground">
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
          </section>
        )}
      </div>
    </DetailCard>
  );
}
