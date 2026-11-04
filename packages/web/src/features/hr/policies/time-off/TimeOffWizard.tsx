import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SuggestedTimeOffPolicy, TimeOffTypeKey } from "@sfa/shared";
import { FormError } from "@/components/form";
import { WizardFooter } from "@/components/common/WizardFooter";
import { Button } from "@/components/ui/button";
import { useAppForm } from "@/hooks/form";
import { ApiError } from "@/lib/api-client";
import { ownsPath } from "@/lib/field-paths";
import { createHrPolicy, hrKeys } from "@/lib/hr-api";
import { PolicyStepBar } from "../PolicyStepBar";
import { PolicyWizardShell } from "../PolicyWizardShell";
import { AccrualStep } from "./steps/AccrualStep";
import { BasicSetupStep } from "./steps/BasicSetupStep";
import { EnrollmentStep } from "./steps/EnrollmentStep";
import { ReviewStep } from "./steps/ReviewStep";
import { SettingsStep } from "./steps/SettingsStep";
import {
  timeOffDefaults,
  timeOffFormSchema,
  toRules,
  toStartingBalances,
  type TimeOffFormValues,
  type TimeOffSection,
} from "./time-off-form";
import { visibleSteps, type TimeOffStep, type TimeOffStepId } from "./time-off-steps";

const SECTION_STEP: Record<TimeOffSection, TimeOffStepId> = {
  basics: "basics",
  settings: "settings",
  accrual: "accrual",
  enrollment: "enrollment",
  autoApprove: "review",
};

/**
 * The time off policy wizard (PAC-174): Gusto's five steps — Basic setup,
 * Settings, Accrual (not for Unlimited), Enrollment, Review — on one
 * TanStack form, nothing written until Activate.
 *
 * Per-step validation is the Onboard Agency wizard's: validate the fields
 * the step owns, read the verdict back out of field meta (`validateField`'s
 * return is unreliable on a mounted field), and at Activate run the whole
 * form and send the admin back to the first step that fails rather than to
 * an error they cannot see. See `docs/tanstack-form-spike-findings.md`.
 *
 * Wizard state is client-side (decided): leaving discards it.
 */
export function TimeOffWizard({
  type,
  preset,
}: {
  type: TimeOffTypeKey;
  preset: SuggestedTimeOffPolicy | null;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [stepIndex, setStepIndex] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (values: TimeOffFormValues) =>
      createHrPolicy({
        type: "time_off",
        name: values.name.trim(),
        timeOff: toRules(values),
        memberIds: values.memberIds,
        startingBalanceHours: toStartingBalances(values),
      }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: hrKeys.all });
      toast.success(`Activated ${saved.name}.`);
      navigate(`/settings/hr-policies/${saved.id}`);
    },
    onError: (failure) => {
      setSubmitError(
        failure instanceof ApiError ? failure.message : "Could not activate the policy. Try again.",
      );
    },
  });

  const form = useAppForm({
    defaultValues: useMemo(() => timeOffDefaults(type, preset), [type, preset]),
    validators: { onBlur: timeOffFormSchema },
    onSubmit: ({ value }) => {
      setSubmitError(null);
      create.mutate(value);
    },
  });

  const accrualType = useStore(form.store, (s) => s.values.accrualType);
  const steps = visibleSteps(accrualType);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const atLastStep = step.id === "review";

  const stepHasErrors = (target: TimeOffStep) =>
    Object.entries(form.state.fieldMeta).some(
      ([path, meta]) => ownsPath(target.fields, path) && (meta?.errors.length ?? 0) > 0,
    );

  const validateStep = async (target: TimeOffStep) => {
    const registered = Object.keys(form.state.fieldMeta) as Array<keyof typeof form.state.fieldMeta>;
    const paths = new Set([
      ...target.fields,
      ...registered.filter((path) => ownsPath(target.fields, String(path))),
    ]);
    await Promise.all([...paths].map((p) => form.validateField(p, "submit")));
    await form.validate("submit");
    return !stepHasErrors(target);
  };

  const goToStep = (index: number) => {
    setSubmitError(null);
    setStepIndex(index);
    window.scrollTo({ top: 0 });
  };

  const advance = async () => {
    if (await validateStep(step)) goToStep(stepIndex + 1);
  };

  const submitAll = async () => {
    await form.validate("submit");
    const failed = steps.findIndex(stepHasErrors);
    if (failed >= 0) {
      await validateStep(steps[failed]);
      goToStep(failed);
      return;
    }
    await form.handleSubmit();
  };

  const onEdit = (section: TimeOffSection) => {
    const index = steps.findIndex((s) => s.id === SECTION_STEP[section]);
    if (index >= 0) goToStep(index);
  };

  return (
    <PolicyWizardShell type="time_off" title="Create time off policy">
      <div className="space-y-1">
        <PolicyStepBar
          steps={steps}
          current={stepIndex}
          onSelect={(target) => target < stepIndex && goToStep(target)}
        />
        <p className="text-xs text-muted-foreground">
          Step {stepIndex + 1} of {steps.length}
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void (atLastStep ? submitAll() : advance());
        }}
        className="space-y-4"
      >
        {step.id === "basics" && <BasicSetupStep form={form} locked={false} />}
        {step.id === "settings" && <SettingsStep form={form} />}
        {step.id === "accrual" && <AccrualStep form={form} />}
        {step.id === "enrollment" && (
          <EnrollmentStep form={form} policyId={null} existingMemberIds={[]} />
        )}
        {step.id === "review" && <ReviewStep form={form} onEdit={onEdit} />}

        <FormError>{submitError}</FormError>

        <WizardFooter
          onBack={stepIndex > 0 ? () => goToStep(stepIndex - 1) : undefined}
          disabled={create.isPending}
        >
          <Button type="submit" variant="brand" disabled={create.isPending}>
            {atLastStep ? (create.isPending ? "Activating…" : "Activate") : "Continue"}
          </Button>
        </WizardFooter>
      </form>
    </PolicyWizardShell>
  );
}
