import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DEFAULT_WORK_WEEK_DAYS,
  FEDERAL_HOLIDAY_KEYS,
  POLICY_NAME_MAX_LENGTH,
  type CreatablePolicyType,
  type CustomHoliday,
  type HolidayKey,
  type TimeOffPolicyView,
  type WorkWeekDay,
} from "@sfa/shared";
import { FormError } from "@/components/form";
import { WizardFooter } from "@/components/common/WizardFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { ApiError } from "@/lib/api-client";
import {
  createTimeOffPolicy,
  getTimeOffPolicy,
  hrKeys,
  updateTimeOffPolicy,
} from "@/lib/hr-api";
import {
  CustomHolidaysEditor,
  HolidayChecklist,
  HolidayYearSummary,
} from "./HolidaySteps";
import { PeopleStep } from "./PeopleStep";
import { PolicyStepBar } from "./PolicyStepBar";
import { POLICY_TYPE_META } from "./policy-display";
import { WorkWeekSchedule, workWeekError } from "./WorkWeekStep";

/** Everything the wizard edits, whichever type it is. */
interface Draft {
  name: string;
  holidays: HolidayKey[];
  customHolidays: CustomHoliday[];
  days: WorkWeekDay[];
  memberIds: string[];
}

type StepId = "federal" | "custom" | "schedule" | "people";

const STEPS: Record<CreatablePolicyType, { id: StepId; label: string }[]> = {
  holiday: [
    { id: "federal", label: "Select federal holidays" },
    { id: "custom", label: "Add custom holidays" },
    { id: "people", label: "Add employees" },
  ],
  work_week: [
    { id: "schedule", label: "Set the work week" },
    { id: "people", label: "Add employees" },
  ],
};

const SLUG_TO_TYPE: Record<string, CreatablePolicyType> = {
  holiday: "holiday",
  "work-week": "work_week",
};

function newDraft(type: CreatablePolicyType): Draft {
  return {
    name: type === "holiday" ? "Paid holidays" : "Standard work week",
    // A new holiday policy starts with the federal list ticked.
    holidays: type === "holiday" ? [...FEDERAL_HOLIDAY_KEYS] : [],
    customHolidays: [],
    days: [...DEFAULT_WORK_WEEK_DAYS],
    memberIds: [],
  };
}

function draftFrom(policy: TimeOffPolicyView): Draft {
  return {
    name: policy.name,
    holidays: policy.type === "holiday" ? [...policy.holiday.holidays] : [],
    customHolidays: policy.type === "holiday" ? [...policy.holiday.customHolidays] : [],
    days: policy.type === "work_week" ? [...policy.workWeek.days] : [...DEFAULT_WORK_WEEK_DAYS],
    memberIds: policy.members.map((member) => member.id),
  };
}

/**
 * Create a Holiday or Work week policy at `/settings/time-off/new/:type`, or
 * edit one at `/settings/time-off/:policyId` (PAC-161 v3).
 *
 * Stepped the way Gusto does it — a bar per step, the rules first and the
 * people last — and nothing is written until the last step's Save. Editing
 * opens the same steps with every one reachable from the bar, and Save on
 * any of them.
 */
export default function PolicyWizardPage() {
  const { typeSlug, policyId } = useParams();
  const createType = typeSlug ? SLUG_TO_TYPE[typeSlug] : undefined;

  const existing = useQuery({
    queryKey: hrKeys.policy(policyId ?? ""),
    queryFn: () => getTimeOffPolicy(policyId as string),
    enabled: Boolean(policyId),
  });

  if (policyId) {
    if (existing.isPending) return <Shell type={null} editing><Skeleton className="h-64 w-full" /></Shell>;
    if (existing.isError || !existing.data) {
      return (
        <Shell type={null} editing>
          <p className="text-sm text-destructive">
            {existing.error instanceof ApiError && existing.error.status === 404
              ? "This policy does not exist, or it has been archived."
              : "Could not load the policy."}
          </p>
        </Shell>
      );
    }
    const policy = existing.data;
    return (
      <Wizard
        key={policy.id}
        type={policy.type}
        policyId={policy.id}
        initial={draftFrom(policy)}
      />
    );
  }

  if (!createType) {
    return (
      <Shell type={null} editing={false}>
        <p className="text-sm text-muted-foreground">That kind of policy cannot be created here.</p>
      </Shell>
    );
  }
  return <Wizard type={createType} policyId={null} initial={newDraft(createType)} />;
}

function Shell({
  type,
  editing,
  children,
}: {
  type: CreatablePolicyType | null;
  editing: boolean;
  children: React.ReactNode;
}) {
  const meta = type ? POLICY_TYPE_META[type] : null;
  const noun = meta ? meta.singular : "policy";
  const title = `${editing ? "Edit" : "Create"} ${noun}`;
  return (
    <SettingsPage
      title={title.charAt(0).toUpperCase() + title.slice(1)}
      caption="Time off"
      icon={meta?.icon ?? POLICY_TYPE_META.holiday.icon}
      backTo={type ? `/settings/time-off?type=${type}` : "/settings/time-off"}
    >
      <div className="space-y-6">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link to="/settings/time-off" className="text-primary underline-offset-4 hover:underline">
            Time off
          </Link>
          {meta && (
            <>
              {" / "}
              <span className="capitalize">{meta.singular}</span>
            </>
          )}
        </nav>
        {children}
      </div>
    </SettingsPage>
  );
}

function Wizard({
  type,
  policyId,
  initial,
}: {
  type: CreatablePolicyType;
  policyId: string | null;
  initial: Draft;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const steps = STEPS[type];
  const editing = policyId !== null;
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const step = steps[index];
  const last = index === steps.length - 1;

  const patch = (next: Partial<Draft>) => {
    setError(null);
    setDraft((current) => ({ ...current, ...next }));
  };

  const save = useMutation({
    mutationFn: () => {
      const name = draft.name.trim();
      const rules =
        type === "holiday"
          ? { holiday: { holidays: draft.holidays, customHolidays: draft.customHolidays } }
          : { workWeek: { days: draft.days } };
      if (policyId) {
        return updateTimeOffPolicy(policyId, { name, ...rules, memberIds: draft.memberIds });
      }
      return type === "holiday"
        ? createTimeOffPolicy({
            type,
            name,
            holiday: { holidays: draft.holidays, customHolidays: draft.customHolidays },
            memberIds: draft.memberIds,
          })
        : createTimeOffPolicy({
            type,
            name,
            workWeek: { days: draft.days },
            memberIds: draft.memberIds,
          });
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: hrKeys.all });
      toast.success(`${editing ? "Saved" : "Created"} ${saved.name}.`);
      navigate(`/settings/time-off?type=${type}`);
    },
    onError: (failure) => {
      setError(
        failure instanceof ApiError ? failure.message : "Could not save the policy. Try again.",
      );
    },
  });

  /** The first problem on a step, or `null` when it may be left. */
  const problemOn = (id: StepId): string | null => {
    if (id === "federal" || id === "schedule") {
      const name = draft.name.trim();
      if (!name) return "Give the policy a name.";
      if (name.length > POLICY_NAME_MAX_LENGTH) {
        return `Keep the name under ${POLICY_NAME_MAX_LENGTH} characters.`;
      }
    }
    if (id === "schedule") return workWeekError(draft.days);
    return null;
  };

  const goTo = (target: number) => {
    // Forward past a step with a problem stops on it; back is always allowed.
    for (let i = index; i < target; i += 1) {
      const problem = problemOn(steps[i].id);
      if (problem) {
        setIndex(i);
        setError(problem);
        return;
      }
    }
    setError(null);
    setIndex(target);
    window.scrollTo({ top: 0 });
  };

  const submit = () => {
    const failing = steps.findIndex((s) => problemOn(s.id));
    if (failing >= 0) {
      setIndex(failing);
      setError(problemOn(steps[failing].id));
      return;
    }
    save.mutate();
  };

  const nameField = (
    <div className="max-w-md space-y-1.5">
      <Label htmlFor="policy-name">Policy name</Label>
      <Input
        id="policy-name"
        value={draft.name}
        maxLength={POLICY_NAME_MAX_LENGTH}
        onChange={(event) => patch({ name: event.target.value })}
      />
    </div>
  );

  return (
    <Shell type={type} editing={editing}>
      <PolicyStepBar
        steps={steps}
        current={index}
        onSelect={editing ? (target) => goTo(target) : undefined}
      />

      <div className="space-y-4">
        {step.id === "federal" && (
          <>
            {nameField}
            <p className="text-sm text-muted-foreground">
              The office is closed on the holidays you tick, every year. When one
              falls on a weekend it is observed on the Friday before or the Monday
              after.
            </p>
            <HolidayChecklist
              group="federal"
              selected={draft.holidays}
              onChange={(holidays) => patch({ holidays })}
            />
          </>
        )}

        {step.id === "custom" && (
          <>
            <HolidayChecklist
              group="common"
              selected={draft.holidays}
              onChange={(holidays) => patch({ holidays })}
            />
            <CustomHolidaysEditor
              value={draft.customHolidays}
              onChange={(customHolidays) => patch({ customHolidays })}
            />
            <HolidayYearSummary
              holidays={draft.holidays}
              customHolidays={draft.customHolidays}
            />
          </>
        )}

        {step.id === "schedule" && (
          <>
            {nameField}
            <WorkWeekSchedule value={draft.days} onChange={(days) => patch({ days })} />
          </>
        )}

        {step.id === "people" && (
          <PeopleStep
            type={type}
            policyId={policyId}
            value={draft.memberIds}
            onChange={(memberIds) => patch({ memberIds })}
          />
        )}
      </div>

      <FormError>{error}</FormError>

      <WizardFooter
        onBack={index > 0 ? () => goTo(index - 1) : undefined}
        disabled={save.isPending}
        secondary={
          editing && !last ? (
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={submit}>
              Save changes
            </Button>
          ) : undefined
        }
      >
        {last ? (
          <Button type="button" variant="brand" disabled={save.isPending} onClick={submit}>
            {save.isPending ? "Saving…" : editing ? "Save changes" : "Save policy"}
          </Button>
        ) : (
          <Button type="button" variant="brand" onClick={() => goTo(index + 1)}>
            Continue
          </Button>
        )}
      </WizardFooter>
    </Shell>
  );
}
