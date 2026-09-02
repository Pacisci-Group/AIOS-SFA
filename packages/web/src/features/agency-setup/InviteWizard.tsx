import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import type { InvitePreview } from "@/lib/invite-api";
import { StepProgress } from "@/components/common/StepProgress";
import { WizardFooter } from "@/components/common/WizardFooter";
import { SetPasswordForm } from "@/components/auth/SetPasswordForm";
import { FormError, FormGrid, FormSection } from "@/components/form";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { useTenant } from "@/contexts/tenant-context";
import { useAppForm } from "@/hooks/form";
import { completeAgencySetup } from "@/lib/agency-setup-api";
import { ApiError } from "@/lib/api-client";
import { acceptInvite } from "@/lib/invite-api";
import {
  AGENCY_SETUP_STEPS,
  AgencySetupStepContent,
} from "./AgencySetupSteps";

/** Phase 1: what the invitee tells us about themselves before they have a session. */
const profileSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
});

/**
 * Accepting an invite, as a guided flow (PAC-69).
 *
 * ## Two phases, and why the counter spans both from the start
 * Phase 1 is personal — name, then password. Phase 2 is the agency's white-label
 * setup, and only an incoming **owner** sees it (`preview.agencySetupPending`,
 * which the public preview endpoint answers before any session exists). Because
 * that is known up front, the counter reads "Step 1 of 5" from the first screen
 * rather than "Step 1 of 2" followed by three more steps materialising, which
 * reads as a flow that has changed its mind.
 *
 * An ordinary employee sees the two personal steps and lands in the app.
 *
 * ## Why the password step is the phase boundary
 * There is no session until the password is set, so nothing in phase 2 can be
 * called before it. Once `acceptInvite` returns a token pair the wizard adopts
 * the session in place and carries straight on — bouncing an owner to `/login`
 * to type a password they set four seconds ago is the thing this avoids.
 *
 * Every phase-2 step writes as it goes and is skippable; skipping completes the
 * setup so the app never nags. See `AgencySetupSteps`.
 */
export function InviteWizard({
  token,
  preview,
}: {
  token: string;
  preview: InvitePreview;
}) {
  const navigate = useNavigate();
  const { adoptSession, refreshUser } = useAuth();
  const { refresh: refreshBranding } = useTenant();

  const [stepIndex, setStepIndex] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [skippedBranding, setSkippedBranding] = useState(false);

  const personalSteps = [
    {
      id: "profile" as const,
      title: "Your details",
      description: `Joining ${preview.agencyName}.`,
    },
    {
      id: "password" as const,
      title: "Your password",
      description: "At least 8 characters. You will use this to sign in.",
    },
  ];
  const setupSteps = preview.agencySetupPending ? AGENCY_SETUP_STEPS : [];
  const total = personalSteps.length + setupSteps.length;
  const inPersonalPhase = stepIndex < personalSteps.length;
  const setupStep = setupSteps[stepIndex - personalSteps.length];

  const form = useAppForm({
    defaultValues: {
      firstName: preview.firstName ?? "",
      lastName: preview.lastName ?? "",
    },
    validators: { onBlur: profileSchema },
    onSubmit: () => goToStep(1),
  });

  const goToStep = (index: number) => {
    setStepIndex(index);
    window.scrollTo({ top: 0 });
  };

  /** Set the password, adopt the session, and either finish or carry on. */
  async function handlePassword(password: string) {
    setSubmitError(null);
    try {
      const { firstName, lastName } = form.state.values;
      const result = await acceptInvite(token, password, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      // `acceptInvite` has already persisted the tokens; this tells React about
      // the session so `ProtectedRoute` lets them through on the next render.
      adoptSession(result.user);

      if (!setupSteps.length) {
        // `/` is the role landing, which routes them by their real permissions.
        navigate("/", { replace: true });
        return;
      }
      // Phase 2 reads branding and email settings that only exist now there is
      // a session; drop anything cached against the previous (or absent) one.
      void refreshBranding();
      goToStep(personalSteps.length);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : "Could not set your password. Try again.",
      );
    }
  }

  /** Mark setup done and land in the app. */
  async function finish(skipped: boolean) {
    setFinishing(true);
    setSubmitError(null);
    try {
      await completeAgencySetup({ skipped });
      /*
       * Re-read the session **before** navigating, so `RoleLanding` sees
       * `agencySetupPending: false` and does not bounce them straight back here.
       *
       * `refreshUser` rather than invalidating the query: it sets the context's
       * user synchronously once the fetch resolves, where an invalidation only
       * marks it stale and relies on the provider's effect having run by the
       * time the landing route reads it.
       */
      await refreshUser();
      navigate("/", { replace: true });
    } catch (err) {
      setFinishing(false);
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : "Could not finish setting up. Try again.",
      );
    }
  }

  const title = inPersonalPhase
    ? personalSteps[stepIndex].title
    : (setupStep?.title ?? "");
  const description = inPersonalPhase
    ? personalSteps[stepIndex].description
    : (setupStep?.description ?? "");

  return (
    <div className="space-y-5">
      <StepProgress
        step={stepIndex + 1}
        total={total}
        title={title}
        description={description}
        sticky={false}
      />

      {stepIndex === 0 && (
        <form.AppForm>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
            className="space-y-4"
            noValidate
          >
            <FormSection>
              <FormGrid>
                <form.AppField name="firstName">
                  {(f) => (
                    <f.TextField
                      label="First name"
                      autoComplete="given-name"
                      inputClassName="bg-card border-border"
                    />
                  )}
                </form.AppField>
                <form.AppField name="lastName">
                  {(f) => (
                    <f.TextField
                      label="Last name"
                      autoComplete="family-name"
                      inputClassName="bg-card border-border"
                    />
                  )}
                </form.AppField>
              </FormGrid>
              {/*
                The invited address is shown as text, not a field. The token
                already determines the account, so an input — even read-only —
                would look like something to fill in. It is displayed rather
                than dropped because it tells whoever opened the link which
                account they are activating, which matters on a shared machine.
              */}
              <p className="text-xs text-muted-foreground">
                Signing in as{" "}
                <span className="text-foreground">{preview.email}</span>
                {preview.roleNames.length > 0 && (
                  <>
                    {" "}
                    as{" "}
                    <span className="text-foreground">
                      {preview.roleNames.join(", ")}
                    </span>
                  </>
                )}
                .
              </p>
            </FormSection>

            <WizardFooter>
              <Button type="submit" variant="brand" className="active:scale-95">
                Continue
              </Button>
            </WizardFooter>
          </form>
        </form.AppForm>
      )}

      {stepIndex === 1 && (
        <div className="space-y-4">
          <SetPasswordForm
            email={preview.email}
            idPrefix="invite"
            submitLabel={
              setupSteps.length ? "Create password" : "Set password and sign in"
            }
            pendingLabel="Setting your password…"
            error={submitError}
            onSubmit={handlePassword}
            footer={
              <>
                This link expires on{" "}
                {new Date(preview.expiresAt).toLocaleDateString()}.
              </>
            }
          />
          <WizardFooter onBack={() => goToStep(0)} />
        </div>
      )}

      {!inPersonalPhase && setupStep && (
        <div className="space-y-4">
          <AgencySetupStepContent
            id={setupStep.id}
            agencyName={preview.agencyName}
          />

          <FormError>{submitError}</FormError>

          <WizardFooter
            onBack={() => goToStep(stepIndex - 1)}
            disabled={finishing}
            secondary={
              setupStep.skippable ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={finishing}
                  onClick={() => {
                    if (setupStep.id === "brand") setSkippedBranding(true);
                    goToStep(stepIndex + 1);
                  }}
                >
                  Skip for now
                </Button>
              ) : undefined
            }
          >
            <Button
              type="button"
              variant="brand"
              disabled={finishing}
              className="active:scale-95"
              onClick={() => {
                if (setupStep.id === "finish") {
                  void finish(skippedBranding);
                } else {
                  goToStep(stepIndex + 1);
                }
              }}
            >
              {setupStep.id === "finish"
                ? finishing
                  ? "Finishing…"
                  : "Go to my dashboard"
                : "Continue"}
            </Button>
          </WizardFooter>
        </div>
      )}
    </div>
  );
}
