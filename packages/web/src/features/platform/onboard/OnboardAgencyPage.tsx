import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import type { OnboardAgencyResponse } from "@sfa/shared";
import { FormError } from "@/components/form";
import { StepProgress } from "@/components/common/StepProgress";
import { WizardFooter } from "@/components/common/WizardFooter";
import { Button } from "@/components/ui/button";
import { useAppForm } from "@/hooks/form";
import { ApiError } from "@/lib/api-client";
import { ownsPath } from "@/lib/field-paths";
import { onboardAgency, type OnboardAgencyInput } from "@/lib/platform-api";
import { SuperAdminLayout } from "../SuperAdminLayout";
import { AgencyStep } from "./steps/AgencyStep";
import { BranchStep } from "./steps/BranchStep";
import { ModulesStep } from "./steps/ModulesStep";
import { OwnerStep } from "./steps/OwnerStep";
import { ReviewStep } from "./steps/ReviewStep";
import { OnboardSuccess } from "./OnboardSuccess";
import {
  EMPTY_ONBOARD,
  onboardFormSchema,
  toOnboardInput,
  type OnboardFormValues,
} from "./onboard-schema";
import { ONBOARD_STEPS, type OnboardStepId } from "./onboard-steps";

/**
 * Onboard Agency (PAC-69) — the operator flow that turns "a new client signed"
 * into a tenant somebody can log into.
 *
 * ## Why a wizard and not one long form
 * Five unrelated decisions — who the tenant is, where its first branch is, what
 * it has switched on, who runs it, and a last look — with a module grid in the
 * middle that is a screenful on its own. The alternative is a page an operator
 * scrolls twice to find the field they mistyped.
 *
 * ## Where the server's answer lands
 * A duplicate slug or owner email is a `409` that the wizard maps **back to the
 * step that owns it** ({@link stepForError}) rather than showing at the bottom
 * of Review. Getting a "that slug is taken" message on a page with no slug field
 * on it is the failure this whole mapping exists to avoid.
 */
export default function OnboardAgencyPage() {
  const [stepIndex, setStepIndex] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<OnboardAgencyResponse | null>(null);
  const step = ONBOARD_STEPS[stepIndex];
  const atLastStep = stepIndex === ONBOARD_STEPS.length - 1;

  const create = useMutation({
    mutationFn: (input: OnboardAgencyInput) => onboardAgency(input),
    onSuccess: (created) => setResult(created),
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not create the agency. Try again.";
      setSubmitError(message);
      // Send the operator to the field the server objected to. Only conflicts
      // are mapped: a 400 means the client schema and the server's disagree,
      // which is a bug rather than something the operator can fix by editing.
      const target =
        error instanceof ApiError && error.status === 409
          ? stepForError(message)
          : null;
      if (target !== null) goToStep(target);
    },
  });

  const form = useAppForm({
    defaultValues: EMPTY_ONBOARD,
    validators: { onBlur: onboardFormSchema },
    onSubmit: ({ value }) => {
      setSubmitError(null);
      create.mutate(toOnboardInput(value));
    },
  });

  const stepHasErrors = (target: (typeof ONBOARD_STEPS)[number]) =>
    Object.entries(form.state.fieldMeta).some(
      ([path, meta]) =>
        ownsPath(target.fields, path) && (meta?.errors.length ?? 0) > 0,
    );

  /**
   * Is this step's slice of the form valid — and, if not, showing why?
   *
   * The shape the lead intake form and the Sold wizard both use, for the two
   * reasons written up in `docs/tanstack-form-spike-findings.md`: `validateField`'s
   * return value is unreliable on a mounted field, so the verdict is read back
   * out of field meta; and `validateAllFields` only walks mounted fields, so it
   * cannot stand in for a whole-form check once one step at a time is on screen.
   */
  const validateStep = async (target: (typeof ONBOARD_STEPS)[number]) => {
    if (!target.fields.length) return true;
    const registered = Object.keys(form.state.fieldMeta) as Array<
      keyof typeof form.state.fieldMeta
    >;
    const paths = new Set([
      ...target.fields,
      ...registered.filter((path) => ownsPath(target.fields, String(path))),
    ]);
    await Promise.all([...paths].map((p) => form.validateField(p, "submit")));
    await form.validate("submit");
    return !stepHasErrors(target);
  };

  const goToStep = (index: number) => {
    setStepIndex(index);
    window.scrollTo({ top: 0 });
  };

  const advance = async () => {
    if (await validateStep(step)) goToStep(stepIndex + 1);
  };

  const submitAll = async () => {
    // Only the last step is mounted, so `handleSubmit`'s own validation cannot
    // see the earlier ones. Check the whole form and send the operator back to
    // the first step that fails, rather than to an error they cannot see.
    await form.validate("submit");
    const failed = ONBOARD_STEPS.findIndex(stepHasErrors);
    if (failed >= 0) {
      await validateStep(ONBOARD_STEPS[failed]);
      goToStep(failed);
      return;
    }
    await form.handleSubmit();
  };

  const stepContent = useMemo(
    () =>
      ({
        agency: <AgencyStep form={form} />,
        branch: <BranchStep form={form} />,
        modules: <ModulesStep form={form} />,
        owner: <OwnerStep form={form} />,
        review: <ReviewStep form={form} onEdit={goToStep} />,
      }) satisfies Record<OnboardStepId, React.ReactNode>,
    // `form` is stable for the life of the component; `goToStep` closes over
    // nothing that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form],
  );

  if (result) {
    return (
      <SuperAdminLayout>
        <OnboardSuccess
          result={result}
          onOnboardAnother={() => {
            setResult(null);
            setSubmitError(null);
            form.reset();
            goToStep(0);
          }}
        />
      </SuperAdminLayout>
    );
  }

  return (
    <SuperAdminLayout>
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/admin">
            <ArrowLeft size={14} />
            All areas
          </Link>
        </Button>

        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">
            Onboard an agency
          </h2>
          <p className="text-sm text-muted-foreground">
            Creates the agency, its default roles, its first branch and its
            owner&rsquo;s account. The owner receives an email to set a password.
          </p>
        </div>

        <form.AppForm>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // Continue is the submit button, so Enter in a field advances.
              void (atLastStep ? submitAll() : advance());
            }}
            className="space-y-5"
            noValidate
          >
            <StepProgress
              step={stepIndex + 1}
              total={ONBOARD_STEPS.length}
              title={step.title}
              description={step.description}
              sticky={false}
            />

            {stepContent[step.id]}

            <FormError>{submitError}</FormError>

            <WizardFooter
              onBack={stepIndex > 0 ? () => goToStep(stepIndex - 1) : undefined}
              disabled={create.isPending}
            >
              <Button
                type="submit"
                variant="brand"
                disabled={create.isPending}
                className="active:scale-95"
              >
                {atLastStep
                  ? create.isPending
                    ? "Creating agency…"
                    : "Create agency"
                  : "Continue"}
              </Button>
            </WizardFooter>
          </form>
        </form.AppForm>
      </div>
    </SuperAdminLayout>
  );
}

/**
 * Which step owns a server conflict, read off the message.
 *
 * String matching, which is not lovely — but the alternative is a machine-
 * readable error envelope, and nothing else in this app has one (every page
 * collapses a server failure to one string). Matching on the noun each message
 * is built around is stable enough for three fixed messages, and a miss is
 * harmless: the operator stays on Review and reads the same text there.
 */
function stepForError(message: string): number | null {
  const lower = message.toLowerCase();
  if (lower.includes("slug")) return indexOfStep("agency");
  if (lower.includes("ticker")) return indexOfStep("agency");
  if (lower.includes("email")) return indexOfStep("owner");
  return null;
}

function indexOfStep(id: OnboardStepId): number {
  return ONBOARD_STEPS.findIndex((step) => step.id === id);
}
