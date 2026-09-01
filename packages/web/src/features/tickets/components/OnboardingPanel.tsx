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
import { DetailCard, SectionLabel } from "@/components/common/DetailCard";
import { DisabledHint } from "@/components/common/DisabledHint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { getOnboarding } from "@/lib/service-tickets-api";
import { cn } from "@/lib/utils";

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
  const StateIcon = cfg.icon;
  const checklistKeys = ONBOARDING_STEP_CHECKLIST[step.stepKey] ?? [];

  return (
    <DetailCard
      title="Onboarding"
      icon={UserCheck}
      action={
        state === "done" ? (
          <Badge size="sm" variant="ghost" className="bg-success/12 text-success">
            Completed
          </Badge>
        ) : (
          // The hint sits on the wrapper because `Button` is
          // `disabled:pointer-events-none` and would never show a `title` of its
          // own — see `DisabledHint`.
          <DisabledHint
            hint={
              !canWrite
                ? "You do not have permission to update onboarding"
                : !step.isActionable
                  ? "This call has not opened yet"
                  : undefined
            }
          >
            <Button
              variant="outline"
              size="sm"
              disabled={!canWrite || !step.isActionable || isMutating}
              onClick={() => onCompleteStep(step.stepKey)}
              title={
                canWrite && step.isActionable
                  ? "Mark this call complete"
                  : undefined
              }
            >
              Complete
            </Button>
          </DisabledHint>
        )
      }
    >
      <div className="space-y-5">
        <div>
          <p className="text-base text-card-foreground">
            {step.label}
            <span className="ml-2 text-sm text-muted-foreground">
              Step {step.sequence} of {step.totalSteps}
            </span>
          </p>
          {onboarding?.salesProducerName && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <UserCheck aria-hidden className="size-4" />
              Sold by{" "}
              <span className="text-foreground">
                {onboarding.salesProducerName}
              </span>
            </p>
          )}
        </div>

        {/* This step's timing */}
        <div className={cn("flex items-start gap-3 rounded-md border p-3", cfg.wrap)}>
          <StateIcon aria-hidden className={cn("mt-0.5 size-5 shrink-0", cfg.tone)} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base text-card-foreground">{cfg.title}</span>
              {state === "overdue" && (
                <Badge
                  size="sm"
                  variant="ghost"
                  className="bg-red-500/12 text-red-600 dark:text-red-400"
                >
                  Overdue
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {stepDetail(step, state)}
            </p>
          </div>
        </div>

        {/* Chain progress across all three calls */}
        {onboarding && (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <SectionLabel>Client onboarding</SectionLabel>
              {onboarding.isComplete && (
                <Badge
                  size="sm"
                  variant="ghost"
                  className="bg-success/12 text-success"
                >
                  Complete
                </Badge>
              )}
            </div>
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
        )}

        {/* Checklist for this call only */}
        {checklistKeys.length > 0 && onboarding && (
          <section>
            <SectionLabel className="mb-2">{step.label} checklist</SectionLabel>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {checklistKeys.map((key) => (
                <div key={key} className="flex items-center gap-2">
                  <Checkbox
                    id={`onboarding-${step.onboardingId}-${key}`}
                    checked={onboarding.checklist[key]}
                    disabled={!canWrite || isMutating}
                    onCheckedChange={(checked) =>
                      onToggleChecklist(key, checked === true)
                    }
                  />
                  <Label
                    htmlFor={`onboarding-${step.onboardingId}-${key}`}
                    className={cn(
                      "text-sm font-normal",
                      onboarding.checklist[key]
                        ? "text-foreground"
                        : "text-muted-foreground",
                      canWrite ? "cursor-pointer" : "cursor-default",
                    )}
                  >
                    {ONBOARDING_CHECKLIST_LABELS[key]}
                  </Label>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* No email section: completing a call implies its email went out, so
            tracking them separately was double bookkeeping for the CSR. */}
      </div>
    </DetailCard>
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
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1 text-sm",
        isCurrent && "bg-primary/12",
      )}
    >
      <span className="shrink-0">
        {done ? (
          <Check aria-hidden className="size-4 text-success" />
        ) : link.isOverdue ? (
          <AlertTriangle
            aria-hidden
            className="size-4 text-red-600 dark:text-red-400"
          />
        ) : link.isActionable ? (
          <Star aria-hidden className="size-4 text-primary" />
        ) : (
          <Lock aria-hidden className="size-4 text-muted-foreground" />
        )}
      </span>
      <span className={done ? "text-muted-foreground" : "text-foreground"}>
        {link.sequence}. {link.label}
      </span>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
        {done
          ? shortDate(link.completedAt)
          : link.ticketId
            ? link.isOverdue || link.isActionable
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
  { icon: typeof CheckCircle2; tone: string; wrap: string; title: string }
> = {
  done: {
    icon: CheckCircle2,
    tone: "text-success",
    wrap: "border-border",
    title: "Call completed",
  },
  overdue: {
    icon: AlertTriangle,
    tone: "text-red-600 dark:text-red-400",
    wrap: "border-red-500/30 bg-red-500/10",
    title: "Call overdue",
  },
  actionable: {
    icon: Star,
    tone: "text-primary",
    wrap: "border-primary/30 bg-primary/10",
    title: "Ready to call",
  },
  scheduled: {
    icon: Lock,
    tone: "text-muted-foreground",
    wrap: "border-border",
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
