import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Lock,
  Star,
  UserCheck,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  ONBOARDING_CHECKLIST_LABELS,
  ONBOARDING_STEP_CHECKLIST,
  type OnboardingChainStep,
  type OnboardingChecklistKey,
  type OnboardingStepKey,
  type OnboardingStepRef,
} from "@sfa/shared";
import { getOnboarding } from "@/lib/service-tickets-api";

interface OnboardingPanelProps {
  step: OnboardingStepRef;
  canWrite: boolean;
  isMutating?: boolean;
  onCompleteStep: (stepKey: OnboardingStepKey) => void;
  onToggleChecklist: (key: OnboardingChecklistKey, value: boolean) => void;
}

/**
 * The onboarding panel for a single call.
 *
 * Each of the three calls is its own ticket, so this panel shows *this*
 * ticket's step, and pulls the parent record for the chain progress and the
 * client-level checklist. Onboarding is tracked per client, which is why the
 * checklist and email milestones live on the parent rather than here.
 *
 * All timing decisions — whether the call can be made, whether it is overdue —
 * come from the server as booleans. Nothing here compares dates, so a skewed
 * browser clock cannot offer an action the API would reject.
 */
export function OnboardingPanel({
  step,
  canWrite,
  isMutating,
  onCompleteStep,
  onToggleChecklist,
}: OnboardingPanelProps) {
  // The parent record: chain progress plus the per-client checklist. Keyed by
  // onboarding id so completing a step in one ticket refreshes its siblings.
  const onboardingQuery = useQuery({
    queryKey: ["onboarding", step.onboardingId],
    queryFn: () => getOnboarding(step.onboardingId),
  });
  const onboarding = onboardingQuery.data;

  const state = stepState(step);
  const cfg = STEP_STATE_CONFIG[state];
  const checklistKeys = ONBOARDING_STEP_CHECKLIST[step.stepKey] ?? [];

  return (
    <div className="bg-card rounded-lg border border-border p-4 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Onboarding
          </h3>
          <p className="mt-1 text-sm text-foreground">
            {step.label}
            <span className="ml-2 text-xs text-muted-foreground">
              Step {step.sequence} of {step.totalSteps}
            </span>
          </p>
          {onboarding?.salesProducerName ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserCheck className="w-3 h-3" />
              Sold by{" "}
              <span className="text-foreground">
                {onboarding.salesProducerName}
              </span>
            </p>
          ) : null}
        </div>

        {state === "done" ? (
          <span className="shrink-0 text-xs text-[var(--kpi-green)]">
            Completed
          </span>
        ) : (
          <button
            type="button"
            disabled={!canWrite || !step.isActionable || isMutating}
            onClick={() => onCompleteStep(step.stepKey)}
            className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground transition-colors enabled:hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            title={
              !canWrite
                ? "You do not have permission to update onboarding"
                : step.isActionable
                  ? "Mark this call complete"
                  : "This call has not opened yet"
            }
          >
            Complete
          </button>
        )}
      </div>

      {/* This step's timing */}
      <div className={`flex items-start gap-3 rounded-md border p-2.5 ${cfg.wrap}`}>
        <span className={`mt-0.5 shrink-0 ${cfg.iconColor}`}>{cfg.icon}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-foreground">{cfg.title}</span>
            {state === "overdue" ? (
              <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] text-red-400">
                Overdue
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {stepDetail(step, state)}
          </p>
        </div>
      </div>

      {/* Chain progress across all three calls */}
      {onboarding ? (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Client Onboarding
            {onboarding.isComplete ? (
              <span className="ml-2 font-normal normal-case text-[var(--kpi-green)]">
                Complete
              </span>
            ) : null}
          </h4>
          <ol className="space-y-1">
            {onboarding.chain.map((link) => (
              <ChainRow
                key={link.stepKey}
                link={link}
                isCurrent={link.stepKey === step.stepKey}
              />
            ))}
          </ol>
        </section>
      ) : null}

      {/* Checklist for this call only */}
      {checklistKeys.length > 0 && onboarding ? (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            {step.label} Checklist
          </h4>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {checklistKeys.map((key) => (
              <label
                key={key}
                className={`flex items-center gap-2 text-xs ${
                  canWrite ? "cursor-pointer" : "cursor-default"
                }`}
              >
                <input
                  type="checkbox"
                  className="accent-[var(--kpi-blue)]"
                  checked={onboarding.checklist[key]}
                  disabled={!canWrite || isMutating}
                  onChange={(e) => onToggleChecklist(key, e.target.checked)}
                />
                <span
                  className={
                    onboarding.checklist[key]
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  {ONBOARDING_CHECKLIST_LABELS[key]}
                </span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {/* No email section: completing a call implies its email went out, so
          tracking them separately was double bookkeeping for the CSR. */}
    </div>
  );
}

function ChainRow({
  link,
  isCurrent,
}: {
  link: OnboardingChainStep;
  isCurrent: boolean;
}) {
  const done = Boolean(link.completedAt);

  return (
    <li
      className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${
        isCurrent ? "bg-[var(--kpi-blue-bg)]" : ""
      }`}
    >
      <span className="shrink-0">
        {done ? (
          <Check className="w-3.5 h-3.5 text-[var(--kpi-green)]" />
        ) : link.isOverdue ? (
          <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
        ) : link.isActionable ? (
          <Star className="w-3.5 h-3.5 text-[var(--kpi-blue)]" />
        ) : (
          <Lock className="w-3 h-3 text-muted-foreground" />
        )}
      </span>
      <span className={done ? "text-muted-foreground" : "text-foreground"}>
        {link.sequence}. {link.label}
      </span>
      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
        {done
          ? shortDate(link.completedAt)
          : link.ticketId
            ? link.isOverdue
              ? `due ${shortDate(link.dueAt)}`
              : link.isActionable
                ? `due ${shortDate(link.dueAt)}`
                : `opens ${shortDate(link.availableAt)}`
            : // No ticket yet — it is created when the call before it closes.
              "not scheduled"}
      </span>
    </li>
  );
}

type StepState = "done" | "overdue" | "actionable" | "scheduled";

function stepState(step: OnboardingStepRef): StepState {
  if (step.completedAt) return "done";
  if (step.isOverdue) return "overdue";
  if (step.isActionable) return "actionable";
  return "scheduled";
}

const STEP_STATE_CONFIG: Record<
  StepState,
  { icon: React.ReactNode; iconColor: string; wrap: string; title: string }
> = {
  done: {
    icon: <CheckCircle2 className="w-4 h-4" />,
    iconColor: "text-[var(--kpi-green)]",
    wrap: "border-border bg-transparent",
    title: "Call completed",
  },
  overdue: {
    icon: <AlertTriangle className="w-4 h-4" />,
    iconColor: "text-red-400",
    wrap: "border-red-500/30 bg-red-500/5",
    title: "Call overdue",
  },
  actionable: {
    icon: <Star className="w-4 h-4" />,
    iconColor: "text-[var(--kpi-blue)]",
    wrap: "border-[var(--kpi-blue)]/30 bg-[var(--kpi-blue)]/5",
    title: "Ready to call",
  },
  scheduled: {
    icon: <Lock className="w-3.5 h-3.5" />,
    iconColor: "text-muted-foreground",
    wrap: "border-border bg-transparent",
    title: "Scheduled",
  },
};

function stepDetail(step: OnboardingStepRef, state: StepState): string {
  switch (state) {
    case "done":
      return `Completed ${shortDate(step.completedAt)}${
        step.completedByName ? ` by ${step.completedByName}` : ""
      }`;
    case "overdue":
      return `Was due ${shortDate(step.dueAt)}`;
    case "actionable":
      return `Due ${shortDate(step.dueAt)}`;
    case "scheduled":
      return step.availableAt
        ? `Opens ${shortDate(step.availableAt)} · due ${shortDate(step.dueAt)}`
        : "Opens when the previous call is complete";
  }
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
