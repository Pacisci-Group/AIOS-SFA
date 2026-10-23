import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  diffRules,
  overridePaths,
  type DeepPartial,
  type EmployeeProfileView,
  type LeaveAllocations,
  type LeavePolicyRules,
  type LeavePolicyView,
  type WorkSchedule,
} from "@sfa/shared";
import { FormError, FormGrid, FormSection } from "@/components/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { agencyTodayYmd } from "@/lib/dates";
import {
  activateEmployee,
  createLeavePolicy,
  getLeavePolicy,
  hrKeys,
  listLeavePolicies,
  listScheduleTemplates,
  setEmployeeAssignment,
} from "@/lib/hr-api";
import { ScheduleEditor } from "../../components/ScheduleEditor";
import { hrErrorMessage } from "../../settings/hr-error";
import { LeavePolicyEditor } from "../../settings/policies/LeavePolicyEditor";
import {
  fromForm,
  toForm,
  type LeavePolicyFormValues,
} from "../../settings/policies/leave-policy-form";

const WORKWEEK = "__workweek__";

interface RulesEditorPanelProps {
  profile: EmployeeProfileView;
  /** `activate` for a pending or terminated profile; `change` for an active one. */
  mode: "activate" | "change";
  onDone: (next: EmployeeProfileView) => void;
  onCancel: () => void;
}

/**
 * Everything that goes into one assignment entry (PAC-162): the policy, the
 * custom rules over it, the schedule, the allocations, and — on activation —
 * the hire date. One submit, because the API writes them as one history
 * entry with one effective-from day and one reason.
 *
 * ## Custom rules are a diff, never typed
 *
 * The policy editor is reused over the **merged** rules; what it returns is
 * diffed against the template (`diffRules`) and only the difference is sent.
 * The API strips any path equal to the template again, so a value typed back
 * to the policy's is not a custom rule.
 */
export function RulesEditorPanel({ profile, mode, onDone, onCancel }: RulesEditorPanelProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const today = agencyTodayYmd(user?.timeZone);

  const policies = useQuery({ queryKey: hrKeys.policies, queryFn: listLeavePolicies });
  const templates = useQuery({
    queryKey: hrKeys.scheduleTemplates,
    queryFn: listScheduleTemplates,
  });

  const [policyId, setPolicyId] = useState<string>(profile.leavePolicy?.id ?? "");
  const policy = useQuery({
    queryKey: hrKeys.policy(policyId),
    queryFn: () => getLeavePolicy(policyId),
    enabled: policyId.length > 0,
  });

  // The overrides start as the person's own when the policy is unchanged,
  // and empty on a switch — a custom rule over one policy says nothing about
  // another. `editorSeed` bumps to re-mount the editor (the array-field
  // reset trap): a reset to the template is a remount with no overrides.
  const [overrides, setOverrides] = useState<DeepPartial<LeavePolicyRules>>(
    profile.overrides,
  );
  const [editorSeed, setEditorSeed] = useState(0);
  const [templateId, setTemplateId] = useState<string>(
    profile.schedule.templateId ?? WORKWEEK,
  );
  const [scheduleOverride, setScheduleOverride] = useState<WorkSchedule | null>(
    profile.schedule.override,
  );
  const [allocations, setAllocations] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(profile.allocations).map(([key, hours]) => [key, String(hours)]),
    ),
  );
  const [hireDate, setHireDate] = useState(profile.hireDate ?? today);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [newPolicy, setNewPolicy] = useState<{
    values: LeavePolicyFormValues;
    name: string;
  } | null>(null);

  const merged = useMemo(
    () => (policy.data ? applyOverrides(policy.data.rules, overrides) : null),
    [policy.data, overrides],
  );
  const overridden = useMemo(() => overridePaths(overrides), [overrides]);
  const balanceTypes = merged
    ? merged.leaveTypes.filter((t) => t.active && t.drawsFromBalance)
    : [];
  const fallbackSchedule =
    templateId === WORKWEEK
      ? null
      : (templates.data?.templates.find((t) => t.id === templateId)?.schedule ?? null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["hr"] });
  };

  const save = useMutation({
    mutationFn: async (input: {
      leavePolicyId: string;
      overrides: DeepPartial<LeavePolicyRules>;
    }) => {
      const parsedAllocations: LeaveAllocations = {};
      for (const [key, text] of Object.entries(allocations)) {
        if (text.trim() !== "") parsedAllocations[key] = Number(text);
      }
      const common = {
        leavePolicyId: input.leavePolicyId,
        overrides: input.overrides,
        scheduleTemplateId: templateId === WORKWEEK ? null : templateId,
        scheduleOverride,
        allocations: parsedAllocations,
        ...(effectiveFrom ? { effectiveFrom } : {}),
      };
      return mode === "activate"
        ? activateEmployee(profile.userId, {
            ...common,
            hireDate,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          })
        : setEmployeeAssignment(profile.userId, { ...common, reason: reason.trim() });
    },
    onSuccess: (next) => {
      invalidate();
      toast.success(
        mode === "activate"
          ? profile.status === "terminated"
            ? "Rehired."
            : "Activated."
          : "Rules updated.",
      );
      onDone(next);
    },
    onError: (error) => setServerError(hrErrorMessage(error)),
  });

  const saveAsNewPolicy = useMutation({
    mutationFn: async ({ values, name }: { values: LeavePolicyFormValues; name: string }) => {
      const created: LeavePolicyView = await createLeavePolicy({
        name,
        rules: fromForm(values).rules,
      });
      return created;
    },
    onSuccess: (created) => {
      invalidate();
      toast.success(`"${created.name}" created.`);
      setNewPolicy(null);
      // On the new policy, with nothing custom: it *is* their rules now.
      save.mutate({ leavePolicyId: created.id, overrides: {} });
    },
    onError: (error) => setServerError(hrErrorMessage(error)),
  });

  const activePolicies = policies.data?.policies.filter((p) => p.status === "active") ?? [];

  if (policies.isPending || templates.isPending) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }
  if (activePolicies.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">
        There is no active leave policy to put this person on. Add one under
        Workspace Settings → HR → Leave policies first.
      </div>
    );
  }

  const submit = (values: LeavePolicyFormValues, intent?: "newPolicy") => {
    if (!policy.data) return;
    setServerError(null);
    if (mode === "change" && !reason.trim()) {
      setServerError("Give a reason for the change.");
      return;
    }
    if (intent === "newPolicy") {
      setNewPolicy({ values, name: "" });
      return;
    }
    // `fromForm` builds every section; its return type is the PATCH shape.
    const edited = fromForm(values).rules as LeavePolicyRules;
    save.mutate({ leavePolicyId: policy.data.id, overrides: diffRules(policy.data.rules, edited) });
  };

  const busy = save.isPending || saveAsNewPolicy.isPending;

  return (
    <div className="space-y-4">
      <FormSection
        title={mode === "activate" ? (profile.status === "terminated" ? "Rehire" : "Onboard") : "Change rules"}
        description={
          mode === "activate"
            ? "Pick their leave policy, adjust anything that differs, set their schedule and start date."
            : "A new entry in their history from the day you choose; what was posted before it is untouched."
        }
      >
        <FormGrid columns={3} gap={3}>
          <div className="space-y-2">
            <Label htmlFor="hr-emp-policy">Leave policy</Label>
            <Select
              value={policyId || undefined}
              onValueChange={(value) => {
                setPolicyId(value);
                setOverrides(value === profile.leavePolicy?.id ? profile.overrides : {});
                setEditorSeed((n) => n + 1);
              }}
            >
              <SelectTrigger id="hr-emp-policy" className="w-full bg-card border-border">
                <SelectValue placeholder="Choose a policy" />
              </SelectTrigger>
              <SelectContent>
                {activePolicies.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {mode === "activate" && (
            <div className="space-y-2">
              <Label htmlFor="hr-emp-hire">Hire date</Label>
              <Input
                id="hr-emp-hire"
                type="date"
                max={today}
                value={hireDate}
                className="bg-card border-border"
                onChange={(e) => setHireDate(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="hr-emp-from">Effective from</Label>
            <Input
              id="hr-emp-from"
              type="date"
              max={today}
              min={mode === "activate" ? hireDate : (profile.assignments[0]?.effectiveFrom ?? undefined)}
              value={effectiveFrom}
              placeholder={mode === "activate" ? hireDate : today}
              className="bg-card border-border"
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {mode === "activate"
                ? "Blank means the hire date."
                : "Blank means today. Not before the previous change."}
            </p>
          </div>
        </FormGrid>
        <div className="space-y-2">
          <Label htmlFor="hr-emp-reason">Reason{mode === "change" ? "" : " (optional)"}</Label>
          <Input
            id="hr-emp-reason"
            value={reason}
            placeholder={mode === "activate" ? "Onboarded" : "Promoted to senior producer"}
            className="bg-card border-border"
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </FormSection>

      <FormSection
        title="Schedule"
        description="A template, a day-by-day override over it, or neither — then the agency workweek, 9 to 5."
      >
        <div className="space-y-3">
          <div className="max-w-sm space-y-2">
            <Label htmlFor="hr-emp-template">Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger id="hr-emp-template" className="w-full bg-card border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={WORKWEEK}>Agency workweek</SelectItem>
                {(templates.data?.templates ?? [])
                  .filter((t) => t.status === "active" || t.id === profile.schedule.templateId)
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      {t.status === "archived" ? " (archived)" : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {scheduleOverride ? (
            <>
              <ScheduleEditor
                value={scheduleOverride}
                onChange={setScheduleOverride}
                fallback={fallbackSchedule}
                idPrefix="hr-emp-sched"
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => setScheduleOverride(null)}>
                Remove the override
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setScheduleOverride(fallbackSchedule ?? {})}
            >
              Override day by day
            </Button>
          )}
        </div>
      </FormSection>

      {merged && balanceTypes.length > 0 && (
        <FormSection
          title="Annual allocations"
          description="Hours per leave type that draws from a balance. Blank means the policy's figure."
        >
          <FormGrid columns={3} gap={3}>
            {balanceTypes.map((type) => (
              <div key={type.key} className="space-y-2">
                <Label htmlFor={`hr-emp-alloc-${type.key}`}>{type.label} (hours)</Label>
                <Input
                  id={`hr-emp-alloc-${type.key}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  placeholder={String(merged.pto.annualAllocationHours)}
                  value={allocations[type.key] ?? ""}
                  className="bg-card border-border"
                  onChange={(e) =>
                    setAllocations((current) => ({ ...current, [type.key]: e.target.value }))
                  }
                />
              </div>
            ))}
          </FormGrid>
        </FormSection>
      )}

      {policy.isPending && policyId ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : policy.data && merged ? (
        <LeavePolicyEditor
          key={`${policy.data.id}:${policy.data.version}:${editorSeed}`}
          mode="overrides"
          initial={toForm(policy.data.name, merged)}
          overriddenPaths={overridden}
          onResetToTemplate={() => {
            setOverrides({});
            setEditorSeed((n) => n + 1);
          }}
          saving={busy}
          serverError={serverError}
          saveLabel={
            mode === "activate"
              ? profile.status === "terminated"
                ? "Rehire"
                : "Activate"
              : "Save rules"
          }
          newPolicyLabel="Save as new policy…"
          onSubmit={submit}
          onCancel={onCancel}
        />
      ) : (
        <div className="space-y-3">
          <FormError>{serverError}</FormError>
          <div className="flex justify-end">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <Dialog open={newPolicy !== null} onOpenChange={(open) => !open && setNewPolicy(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save as a new policy</DialogTitle>
            <DialogDescription>
              The rules as edited become a named policy of the agency's, and this person goes
              on it with nothing custom. Other people can be put on it later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="hr-new-policy-name">Policy name</Label>
            <Input
              id="hr-new-policy-name"
              value={newPolicy?.name ?? ""}
              placeholder="Senior producers"
              autoComplete="off"
              className="bg-card border-border"
              onChange={(e) =>
                setNewPolicy((current) => (current ? { ...current, name: e.target.value } : current))
              }
            />
          </div>
          <FormError>{serverError}</FormError>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNewPolicy(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="brand"
              disabled={busy || !newPolicy?.name.trim()}
              onClick={() =>
                newPolicy &&
                saveAsNewPolicy.mutate({ values: newPolicy.values, name: newPolicy.name.trim() })
              }
            >
              {busy ? "Saving…" : "Create and assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Template + overrides, the way the API merges them: by path, arrays whole,
 * paths the template lacks ignored. Kept here (not in `@sfa/shared`) because
 * the API's `mergeRules` is the one of record and this only previews it.
 */
function applyOverrides(
  template: LeavePolicyRules,
  overrides: DeepPartial<LeavePolicyRules>,
): LeavePolicyRules {
  const merge = (base: Record<string, unknown>, patch: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || !(key in base)) continue;
      const current = base[key];
      if (isPlain(current) && isPlain(value)) {
        out[key] = merge(current, value);
      } else {
        out[key] = value;
      }
    }
    return out;
  };
  return merge(
    structuredClone(template) as unknown as Record<string, unknown>,
    overrides as Record<string, unknown>,
  ) as unknown as LeavePolicyRules;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}
