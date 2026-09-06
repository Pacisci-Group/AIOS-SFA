import type { DeepKeys } from "@tanstack/react-form";
import type { OnboardFormValues } from "./onboard-schema";

/** One page of the Onboard Agency wizard. */
export type OnboardStepId =
  | "agency"
  | "branch"
  | "modules"
  | "owner"
  | "review";

export interface OnboardStep {
  id: OnboardStepId;
  title: string;
  description: string;
  /**
   * The field paths this step owns, as path **roots** — the same contract as
   * the lead intake form's `IntakeStep.fields` and the Sold wizard's
   * `CARD_FIELDS`. `validateStep` walks every registered path underneath, which
   * is what makes a nested field's error block its own step rather than
   * surfacing three pages later.
   */
  fields: Array<DeepKeys<OnboardFormValues>>;
}

/**
 * The steps, in order. Data rather than logic scattered through the JSX, so
 * adding one cannot forget to validate it.
 */
export const ONBOARD_STEPS: readonly OnboardStep[] = [
  {
    id: "agency",
    title: "Agency",
    description: "Who the tenant is, and the name their app will live under.",
    fields: ["agency"],
  },
  {
    id: "branch",
    title: "First branch",
    description:
      "Every user and every record belongs to a branch. More can be added later.",
    fields: ["branch"],
  },
  {
    id: "modules",
    title: "Modules",
    description: "What this agency has switched on. Adjustable at any time.",
    fields: ["modules"],
  },
  {
    id: "owner",
    title: "Owner",
    description:
      "The first account. They get an email to set a password and finish setting up.",
    fields: ["owner"],
  },
  {
    id: "review",
    title: "Review",
    description: "Check it over, then create the agency.",
    fields: [],
  },
];
