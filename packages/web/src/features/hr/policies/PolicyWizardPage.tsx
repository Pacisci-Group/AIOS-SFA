import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DEFAULT_WORK_WEEK_DAYS,
  FEDERAL_HOLIDAY_KEYS,
  POLICY_NAME_MAX_LENGTH,
  SUGGESTED_TIME_OFF_POLICIES,
  TIME_OFF_TYPE_KEYS,
  type CustomHoliday,
  type HolidayKey,
  type HrPolicyView,
  type MemberListPolicyType,
  type TimeOffTypeKey,
  type WorkWeekDay,
} from "@sfa/shared";
import { FormError } from "@/components/form";
import { WizardFooter } from "@/components/common/WizardFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api-client";
import {
  createHrPolicy,
  getHrPolicy,
  hrKeys,
  updateHrPolicy,
} from "@/lib/hr-api";
import {
  CustomHolidaysEditor,
  HolidayChecklist,
  HolidayYearSummary,
} from "./HolidaySteps";
import { PeopleStep } from "./PeopleStep";
import { PolicyStepBar } from "./PolicyStepBar";
import { PolicyWizardShell } from "./PolicyWizardShell";
import { POLICY_TYPE_META } from "./policy-display";
import { TimeOffPolicyPage } from "./time-off/TimeOffPolicyPage";
import { TimeOffTypePicker } from "./time-off/TimeOffTypePicker";
import { TimeOffWizard } from "./time-off/TimeOffWizard";
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

const STEPS: Record<MemberListPolicyType, { id: StepId; label: string }[]> = {
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

const SLUG_TO_TYPE: Record<string, MemberListPolicyType> = {
  holiday: "holiday",
  "work-week": "work_week",
};

/** `/settings/hr-policies/new/time-off` — the third type has its own wizard. */
const TIME_OFF_SLUG = "time-off";

function isTimeOffType(value: string | null): value is TimeOffTypeKey {
  return (TIME_OFF_TYPE_KEYS as readonly string[]).includes(value ?? "");
}

function newDraft(type: MemberListPolicyType): Draft {
  return {
    name: type === "holiday" ? "Paid holidays" : "Standard work week",
    // A new holiday policy starts with the federal list ticked.
    holidays: type === "holiday" ? [...FEDERAL_HOLIDAY_KEYS] : [],
    customHolidays: [],
    days: [...DEFAULT_WORK_WEEK_DAYS],
    memberIds: [],
  };
}

function draftFrom(policy: HrPolicyView): Draft {
  return {
    name: policy.name,
    holidays: policy.type === "holiday" ? [...policy.holiday.holidays] : [],
    customHolidays: policy.type === "holiday" ? [...policy.holiday.customHolidays] : [],
    days: policy.type === "work_week" ? [...policy.workWeek.days] : [...DEFAULT_WORK_WEEK_DAYS],
    memberIds: policy.members.map((member) => member.id),
  };
}

/**
 * Create a policy at `/settings/hr-policies/new/:type`, or open one at
 * `/settings/hr-policies/:policyId` (PAC-161 v3, PAC-174).
 *
 * Holiday and Work week: stepped the way Gusto does it — a bar per step, the
 * rules first and the people last — and nothing is written until the last
 * step's Save; editing opens the same steps with every one reachable from
 * the bar. Time off (`new/time-off`): the type picker, then its own
 * five-step TanStack Form wizard (`?type=` picks the kind, `&preset=1`
 * pre-fills a suggested policy); an activated one opens on its policy page
 * with per-section drawers rather than the wizard.
 */
export default function PolicyWizardPage() {
  const { typeSlug, policyId } = useParams();
  const [params] = useSearchParams();
  const createType = typeSlug ? SLUG_TO_TYPE[typeSlug] : undefined;

  const existing = useQuery({
    queryKey: hrKeys.policy(policyId ?? ""),
    queryFn: () => getHrPolicy(policyId as string),
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
    if (policy.type === "time_off") {
      return <TimeOffPolicyPage key={policy.id} policy={policy} />;
    }
    return (
      <Wizard
        key={policy.id}
        type={policy.type}
        policyId={policy.id}
        initial={draftFrom(policy)}
      />
    );
  }

  if (typeSlug === TIME_OFF_SLUG) {
    const type = params.get("type");
    if (!isTimeOffType(type)) return <TimeOffTypePicker />;
    const preset = params.get("preset")
      ? (SUGGESTED_TIME_OFF_POLICIES.find((s) => s.key === type) ?? null)
      : null;
    return <TimeOffWizard key={`${type}-${preset ? "preset" : "blank"}`} type={type} preset={preset} />;
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
  type: MemberListPolicyType | null;
  editing: boolean;
  children: React.ReactNode;
}) {
  const noun = type ? POLICY_TYPE_META[type].singular : "policy";
  const title = `${editing ? "Edit" : "Create"} ${noun}`;
  return (
    <PolicyWizardShell type={type} title={title.charAt(0).toUpperCase() + title.slice(1)}>
      {children}
    </PolicyWizardShell>
  );
}

function Wizard({
  type,
  policyId,
  initial,
}: {
  type: MemberListPolicyType;
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
        return updateHrPolicy(policyId, { name, ...rules, memberIds: draft.memberIds });
      }
      return type === "holiday"
        ? createHrPolicy({
            type,
            name,
            holiday: { holidays: draft.holidays, customHolidays: draft.customHolidays },
            memberIds: draft.memberIds,
          })
        : createHrPolicy({
            type,
            name,
            workWeek: { days: draft.days },
            memberIds: draft.memberIds,
          });
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: hrKeys.all });
      toast.success(`${editing ? "Saved" : "Created"} ${saved.name}.`);
      navigate(`/settings/hr-policies?type=${type}`);
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
