import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-form";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import {
  defaultStartingBalance,
  type CompleteOnboardingInput,
  type HrPolicySummary,
  type HrPolicyType,
  type PersonProfileView,
} from "@sfa/shared";
import { DataRow } from "@/components/common/DetailCard";
import { FormError, FormGrid, FormSection } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { useAppForm } from "@/hooks/form";
import { ApiError } from "@/lib/api-client";
import { agencyTodayYmd } from "@/lib/dates";
import { hrKeys, listHrPolicies } from "@/lib/hr-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { completeOnboarding, peopleKeys } from "@/lib/people-api";
import { cn } from "@/lib/utils";
import { PolicyStepBar } from "@/features/hr/policies/PolicyStepBar";
import { formatDay, POLICY_TYPE_META, POLICY_TYPE_ORDER, summarizePolicy } from "@/features/hr/policies/policy-display";
import { formatBalance } from "@/features/hr/policies/time-off/time-off-display";
import { PersonSheet } from "./PersonSheet";
import { onboardingFormSchema, type OnboardingFormValues } from "./person-forms";
import { currentOfKind, currentPolicyIds, policyKind } from "./policy-choices";

const STEPS = [{ label: "Details" }, { label: "Policies" }, { label: "Review" }] as const;

/** One policy's tick and, for a fixed-amount time off policy, its balance box. */
interface Choice {
  enrol: boolean;
  /** The input's text; blank = the policy's default. */
  balance: string;
}

/**
 * Complete a person's onboarding (PAC-162, `agency:hr:admin`): three steps
 * in a drawer — confirm the hire date and details, tick the policies they
 * join (with a starting balance per fixed-amount time off policy), review,
 * **Complete** → Active. Nothing here blocks inviting or logging in; it can
 * be done any time while the profile is pending.
 *
 * The Details step is TanStack Form + zod; the policy ticks are component
 * state keyed by policy id (an object, never an array field — memory
 * `tanstack-array-field-reset-trap`) merged into the body at submit. A
 * policy the person is already in is shown ticked and disabled; ticking a
 * second policy of a kind unticks the first, since the server would move
 * them anyway.
 */
export function CompleteOnboardingSheet({
  profile,
  onClose,
}: {
  profile: PersonProfileView;
  onClose: () => void;
}) {
  const { user: viewer } = useAuth();
  const queryClient = useQueryClient();
  const today = agencyTodayYmd(viewer?.timeZone);
  const [step, setStep] = useState(0);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [error, setError] = useState<string | null>(null);

  const policies = useQuery({
    queryKey: hrKeys.policies(null),
    queryFn: () => listHrPolicies(null),
  });
  const all = policies.data?.policies ?? [];
  const mine = currentPolicyIds(profile);

  const complete = useMutation({
    mutationFn: (input: CompleteOnboardingInput) => completeOnboarding(profile.user.id, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: peopleKeys.profile(profile.user.id) }),
        queryClient.invalidateQueries({ queryKey: ["users"] }),
        queryClient.invalidateQueries({ queryKey: hrKeys.all }),
      ]);
      toast.success(`${profile.user.name} is onboarded.`);
      onClose();
    },
    onError: (failure) => {
      if (failure instanceof ApiError && failure.status === 409) {
        // Already complete — someone else got there; the page re-reads.
        void queryClient.invalidateQueries({ queryKey: peopleKeys.profile(profile.user.id) });
        onClose();
        return;
      }
      setError(failure instanceof ApiError ? failure.message : "Could not complete onboarding. Try again.");
    },
  });

  const form = useAppForm({
    defaultValues: {
      hireDate: profile.employment.hireDate ?? today,
      dateOfBirth: profile.employment.dateOfBirth ?? "",
      showBirthday: profile.employment.showBirthday ?? true,
      phone: profile.user.phone ?? "",
    } satisfies OnboardingFormValues,
    validators: { onBlur: onboardingFormSchema(today) },
    onSubmit: ({ value }) => {
      setError(null);
      complete.mutate({
        hireDate: value.hireDate,
        dateOfBirth: value.dateOfBirth.trim() || null,
        showBirthday: value.showBirthday,
        phone: value.phone.trim() || null,
        policies: ticked.map((policy) => {
          const text = choices[policy.id]?.balance.trim() ?? "";
          return text === ""
            ? { policyId: policy.id }
            : { policyId: policy.id, startingBalanceHours: Number(text) };
        }),
      });
    },
  });
  const values = useStore(form.store, (s) => s.values);

  /** The policies being joined now: ticked and not already in. */
  const ticked = all.filter((policy) => choices[policy.id]?.enrol && !mine.has(policy.id));
  const balanceProblem = ticked.some((policy) => {
    const text = choices[policy.id]?.balance.trim() ?? "";
    return text !== "" && (Number.isNaN(Number(text)) || Number(text) < 0);
  });

  const toggle = (policy: HrPolicySummary, on: boolean) => {
    setChoices((prev) => {
      const next = { ...prev, [policy.id]: { enrol: on, balance: prev[policy.id]?.balance ?? "" } };
      if (on) {
        const kind = policyKind(policy);
        if (kind) {
          for (const other of all) {
            if (other.id !== policy.id && policyKind(other) === kind && !mine.has(other.id)) {
              next[other.id] = { enrol: false, balance: prev[other.id]?.balance ?? "" };
            }
          }
        }
      }
      return next;
    });
  };

  /**
   * The Details step's fields, validated with a submit cause and read back
   * off the field meta — `validateField`'s return is unreliable on a mounted
   * field (`docs/tanstack-form-spike-findings.md`).
   */
  const validateDetails = async () => {
    const paths = ["hireDate", "dateOfBirth", "showBirthday", "phone"] as const;
    await Promise.all(paths.map((path) => form.validateField(path, "submit")));
    return paths.every((path) => (form.getFieldMeta(path)?.errors.length ?? 0) === 0);
  };

  const advance = async () => {
    if (step === 0 && !(await validateDetails())) return;
    if (step === 1 && balanceProblem) return;
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  return (
    <PersonSheet eyebrow={profile.user.name} title="Complete onboarding" onClose={onClose}>
      <form.AppForm>
        <form
          className="flex flex-1 flex-col gap-5 px-6 py-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (step < STEPS.length - 1) {
              void advance();
            } else {
              void form.handleSubmit();
            }
          }}
        >
          <PolicyStepBar steps={STEPS} current={step} onSelect={(index) => index < step && setStep(index)} />

          {step === 0 && (
            <div className="space-y-5">
              <FormGrid>
                <form.AppField name="hireDate">
                  {(f) => (
                    <f.TextField
                      label="Hire date"
                      type="date"
                      max={today}
                      description="Their first day. Anniversary resets and waiting periods count from it."
                    />
                  )}
                </form.AppField>
                <form.AppField name="phone">
                  {(f) => <f.TextField label="Phone" type="tel" placeholder="(312) 555-0100" />}
                </form.AppField>
                <form.AppField name="dateOfBirth">
                  {(f) => (
                    <f.TextField
                      label="Date of birth"
                      type="date"
                      max={today}
                      description="Optional. Seen by HR admins and the person; never shown as an age."
                    />
                  )}
                </form.AppField>
              </FormGrid>
              <form.AppField name="showBirthday">
                {(f) => (
                  <f.SwitchField
                    label="Show birthday on the calendar"
                    hint="Month and day only, on the agency calendar."
                  />
                )}
              </form.AppField>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Tick the policies {profile.user.firstName ?? "they"} join. One policy of each kind per
                person; a starting balance is only asked for where it means something.
              </p>
              {policies.isPending ? (
                <div className="space-y-2">
                  <Skeleton className="h-14 w-full rounded-xl" />
                  <Skeleton className="h-14 w-full rounded-xl" />
                </div>
              ) : all.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No policies yet — they can be added later from the profile or Workspace Settings →
                  HR policies.
                </p>
              ) : (
                POLICY_TYPE_ORDER.map((type) => (
                  <PolicyGroup
                    key={type}
                    type={type}
                    policies={all.filter((policy) => policy.type === type)}
                    profile={profile}
                    all={all}
                    choices={choices}
                    mine={mine}
                    today={today}
                    onToggle={toggle}
                    onBalance={(id, balance) =>
                      setChoices((prev) => ({
                        ...prev,
                        [id]: { enrol: prev[id]?.enrol ?? true, balance },
                      }))
                    }
                  />
                ))
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <FormSection
                title="Details"
                action={
                  <Button type="button" variant="outline" size="sm" aria-label="Edit details" onClick={() => setStep(0)}>
                    <Pencil />
                    Edit
                  </Button>
                }
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <DataRow label="Hire date" value={values.hireDate ? formatDay(values.hireDate) : NOT_AVAILABLE} />
                  <DataRow label="Phone" value={values.phone.trim() || NOT_AVAILABLE} />
                  <DataRow
                    label="Date of birth"
                    value={
                      values.dateOfBirth
                        ? `${formatDay(values.dateOfBirth)} · ${values.showBirthday ? "shown on the calendar" : "hidden"}`
                        : NOT_AVAILABLE
                    }
                  />
                </div>
              </FormSection>
              <FormSection
                title="Policies"
                action={
                  <Button type="button" variant="outline" size="sm" aria-label="Edit policies" onClick={() => setStep(1)}>
                    <Pencil />
                    Edit
                  </Button>
                }
              >
                {ticked.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No new policies. They can be added from the profile at any time.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {ticked.map((policy) => {
                      const text = choices[policy.id]?.balance.trim() ?? "";
                      const fallback =
                        policy.type === "time_off" ? defaultStartingBalance(policy.timeOff) : null;
                      return (
                        <li key={policy.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                          <span>
                            <span className="font-medium text-foreground">{policy.name}</span>{" "}
                            <span className="text-muted-foreground">
                              · {POLICY_TYPE_META[policy.type].singular}
                            </span>
                          </span>
                          {policy.type === "time_off" && fallback !== null && (
                            <span className="text-muted-foreground">
                              starts with {formatBalance(text === "" ? fallback : Number(text))}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </FormSection>
            </div>
          )}

          <FormError>{error}</FormError>

          <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
              disabled={complete.isPending}
            >
              {step === 0 ? "Cancel" : "Back"}
            </Button>
            <Button
              type="submit"
              variant="brand"
              disabled={complete.isPending || (step === 1 && balanceProblem)}
            >
              {step < STEPS.length - 1 ? "Continue" : complete.isPending ? "Completing…" : "Complete onboarding"}
            </Button>
          </div>
        </form>
      </form.AppForm>
    </PersonSheet>
  );
}

function PolicyGroup({
  type,
  policies,
  profile,
  all,
  choices,
  mine,
  today,
  onToggle,
  onBalance,
}: {
  type: HrPolicyType;
  policies: HrPolicySummary[];
  profile: PersonProfileView;
  all: HrPolicySummary[];
  choices: Record<string, Choice>;
  mine: Set<string>;
  today: string;
  onToggle: (policy: HrPolicySummary, on: boolean) => void;
  onBalance: (id: string, balance: string) => void;
}) {
  if (!policies.length) return null;
  const meta = POLICY_TYPE_META[type];
  return (
    <FormSection title={meta.label} titleAs="h3">
      <ul className="space-y-2">
        {policies.map((policy) => {
          const already = mine.has(policy.id);
          const on = already || !!choices[policy.id]?.enrol;
          const movesFrom = on && !already ? currentOfKind(profile, all, policyKind(policy)) : null;
          const fallback = policy.type === "time_off" ? defaultStartingBalance(policy.timeOff) : null;
          const inputId = `onboard-balance-${policy.id}`;
          return (
            <li
              key={policy.id}
              className={cn(
                "rounded-xl border px-4 py-3",
                on ? "border-primary/40 bg-primary/5" : "border-border",
              )}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  id={`onboard-policy-${policy.id}`}
                  checked={on}
                  disabled={already}
                  onCheckedChange={(checked) => onToggle(policy, checked === true)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <Label htmlFor={`onboard-policy-${policy.id}`} className="text-sm font-medium text-foreground">
                    {policy.name}
                  </Label>
                  <p className="text-xs text-muted-foreground">{summarizePolicy(policy, today)}</p>
                  {already && <p className="mt-1 text-xs text-muted-foreground">Already in</p>}
                  {movesFrom && (
                    <p className="mt-1 text-xs text-muted-foreground">Moves from {movesFrom.name}</p>
                  )}
                  {on && !already && policy.type === "time_off" && fallback !== null && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Label htmlFor={inputId} className="text-xs text-muted-foreground">
                        Starting balance
                      </Label>
                      <Input
                        id={inputId}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.25"
                        className="h-8 w-28"
                        placeholder={formatBalance(fallback)}
                        value={choices[policy.id]?.balance ?? ""}
                        onChange={(event) => onBalance(policy.id, event.target.value)}
                      />
                      <span className="text-xs text-muted-foreground">hours · blank = {formatBalance(fallback)}</span>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </FormSection>
  );
}
