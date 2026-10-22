import { CheckCircle2 } from "lucide-react";
import { BrandStep } from "./BrandStep";
import { CalendarStep } from "./CalendarStep";
import { CarrierAppointmentsStep } from "./CarrierAppointmentsStep";
import { EmailIdentityStep } from "./EmailIdentityStep";
import { HrPolicyStep } from "./HrPolicyStep";

/**
 * Phase 2 of onboarding: making the app look and sound like the agency (PAC-69).
 *
 * Shared by the invite wizard (where it follows the name and password steps) and
 * by `/welcome/agency` (where it stands alone, for an owner who left partway
 * through). Both render the same three steps in the same order, which is what
 * keeps "Step 4 of 5" and "Step 1 of 3" describing the same work.
 *
 * Every step here is **skippable**, and skipping completes the setup rather than
 * deferring it. An owner who is not ready to think about logos should not be
 * asked again on every sign-in; the same settings stay in `/settings/*`
 * indefinitely.
 */

export type AgencySetupStepId =
  | "brand"
  | "email"
  | "carriers"
  | "calendar"
  | "hr-policy"
  | "finish";

/**
 * Which `AgencySetupView` flag a skipped step records (PAC-69, PAC-161).
 * Steps not listed are skippable without a flag — nothing later keys off them.
 */
export const SKIP_FLAG_BY_STEP: Partial<
  Record<AgencySetupStepId, "skipped" | "calendarSkipped" | "hrPolicySkipped">
> = {
  brand: "skipped",
  calendar: "calendarSkipped",
  "hr-policy": "hrPolicySkipped",
};

export interface AgencySetupStep {
  id: AgencySetupStepId;
  title: string;
  description: string;
  /** Whether this step offers "Skip for now" alongside Continue. */
  skippable: boolean;
}

export const AGENCY_SETUP_STEPS: readonly AgencySetupStep[] = [
  {
    id: "brand",
    title: "Your branding",
    description:
      "Your name and logo, wherever we speak to your team — the app, your sign-in page and your email.",
    skippable: true,
  },
  {
    id: "email",
    title: "Your email",
    description: "How the emails we send on your behalf are addressed.",
    skippable: true,
  },
  {
    id: "carriers",
    title: "Your carriers",
    description:
      "The agency code each carrier that appointed you issued — how we match mailer files to you.",
    skippable: true,
  },
  {
    // PAC-161. Real saves, like the branding step: the workweek, where the
    // agency is, and the holidays the owner ticks.
    id: "calendar",
    title: "Your calendar",
    description:
      "The days your office is open and closed, so time off and attendance are counted on real working days.",
    skippable: true,
  },
  {
    // PAC-161. Starts empty; skipping leaves the agency with no policy, which
    // is a working state — HR is a calendar and nothing more until one exists.
    id: "hr-policy",
    title: "Your leave policies",
    description:
      "One policy for everyone, or one per role. You can skip this and add one later under Settings.",
    skippable: true,
  },
  {
    id: "finish",
    title: "All set",
    description: "That is everything we need.",
    skippable: false,
  },
];

export function AgencySetupStepContent({
  id,
  agencyName,
}: {
  id: AgencySetupStepId;
  agencyName: string;
}) {
  if (id === "brand") return <BrandStep />;
  if (id === "email") return <EmailIdentityStep />;
  if (id === "carriers") return <CarrierAppointmentsStep />;
  if (id === "calendar") return <CalendarStep />;
  if (id === "hr-policy") return <HrPolicyStep />;
  // ⚠ `finish` must stay last: both wizards branch on it to call `complete`.
  return <FinishStep agencyName={agencyName} />;
}

function FinishStep({ agencyName }: { agencyName: string }) {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
          <CheckCircle2 size={16} />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {agencyName} is ready to go.
          </p>
          <p className="text-sm text-muted-foreground">
            Everything you have just set is editable at any time under Settings.
          </p>
        </div>
      </div>

      <ul className="space-y-1.5 border-t border-border pt-3 text-sm text-muted-foreground">
        <li>
          <span className="text-foreground">Invite your team</span> — add
          producers and service staff from Agency Users. They set their own
          passwords, the same way you just did.
        </li>
        <li>
          <span className="text-foreground">Put the app on your own web
          address</span> — add a domain in Settings when you are ready.
        </li>
        <li>
          <span className="text-foreground">Send from your own domain</span> —
          Email settings walks you through the DNS records.
        </li>
      </ul>
    </div>
  );
}
