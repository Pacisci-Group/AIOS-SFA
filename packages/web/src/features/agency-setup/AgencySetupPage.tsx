import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { StepProgress } from "@/components/common/StepProgress";
import { WizardFooter } from "@/components/common/WizardFooter";
import { FormError } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { getBranding } from "@/lib/agency-branding-api";
import { ApiError } from "@/lib/api-client";
import { completeAgencySetup, getAgencySetup } from "@/lib/agency-setup-api";
import {
  AGENCY_SETUP_STEPS,
  AgencySetupStepContent,
} from "./AgencySetupSteps";

/**
 * `/welcome/agency` — phase 2 on its own, for an owner who did not finish it
 * during their invite (PAC-69).
 *
 * Reached by `RoleLanding` redirecting on `user.agencySetupPending`, so an owner
 * who closed the tab mid-wizard picks it up at their next sign-in rather than
 * losing it. It renders the *same* steps as the invite wizard — the counter just
 * starts at one, because the name and password are long since done.
 *
 * Deliberately reachable directly too: an owner who wants another look at the
 * branding step before finishing has somewhere to go, and once setup is complete
 * the page says so rather than 404ing.
 */
export default function AgencySetupPage() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  const [stepIndex, setStepIndex] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skippedBranding, setSkippedBranding] = useState(false);

  const setupQuery = useQuery({
    queryKey: ["agency-setup"],
    queryFn: getAgencySetup,
  });

  /*
   * The agency's own name, from its branding settings — **not**
   * `useTenant().branding.name`.
   *
   * Tenant branding is resolved from the request's `Host`, and an agency with no
   * domain of its own signs in on the platform host, where that resolves to the
   * platform wordmark. So the owner of a brand-new agency would be welcomed to
   * "AgencyOps" rather than to their own agency — on the one screen whose whole
   * job is to feel like theirs.
   */
  const brandingQuery = useQuery({
    queryKey: ["agency-branding"],
    queryFn: getBranding,
  });
  const agencyName =
    brandingQuery.data?.displayName ||
    brandingQuery.data?.agencyName ||
    "your agency";

  const step = AGENCY_SETUP_STEPS[stepIndex];

  const goToStep = (index: number) => {
    setStepIndex(index);
    window.scrollTo({ top: 0 });
  };

  async function finish(skipped: boolean) {
    setFinishing(true);
    setError(null);
    try {
      await completeAgencySetup({ skipped });
      // Re-read the session before navigating, so `RoleLanding` stops sending
      // them back here. See the same call in `InviteWizard` for why this is
      // `refreshUser` and not a query invalidation.
      await refreshUser();
      navigate("/", { replace: true });
    } catch (err) {
      setFinishing(false);
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not finish setting up. Try again.",
      );
    }
  }

  if (setupQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 md:px-6">
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  // Already done — reached by typing the URL, or by finishing in another tab.
  if (setupQuery.data?.status === "complete") {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-10 md:px-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {agencyName} is already set up
        </h1>
        <p className="text-sm text-muted-foreground">
          Your branding and email settings live under Settings, and can be
          changed whenever you like.
        </p>
        <Button variant="brand" onClick={() => navigate("/", { replace: true })}>
          Go to my dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-10 md:px-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          Welcome to {agencyName}
        </h1>
        <p className="text-sm text-muted-foreground">
          A couple of things to make the app yours. You can skip any of them.
        </p>
      </div>

      <StepProgress
        step={stepIndex + 1}
        total={AGENCY_SETUP_STEPS.length}
        title={step.title}
        description={step.description}
        sticky={false}
      />

      <AgencySetupStepContent id={step.id} agencyName={agencyName} />

      <FormError>{error}</FormError>

      <WizardFooter
        onBack={stepIndex > 0 ? () => goToStep(stepIndex - 1) : undefined}
        disabled={finishing}
        secondary={
          step.skippable ? (
            <Button
              type="button"
              variant="ghost"
              disabled={finishing}
              onClick={() => {
                if (step.id === "brand") setSkippedBranding(true);
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
            if (step.id === "finish") {
              void finish(skippedBranding);
            } else {
              goToStep(stepIndex + 1);
            }
          }}
        >
          {step.id === "finish"
            ? finishing
              ? "Finishing…"
              : "Go to my dashboard"
            : "Continue"}
        </Button>
      </WizardFooter>
    </div>
  );
}
