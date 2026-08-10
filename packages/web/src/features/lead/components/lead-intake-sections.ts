import type { DeepKeys } from "@tanstack/react-form";
import type {
  LeadIntakeFormValues,
  LeadIntakeVariant,
} from "./lead-intake-schema";

/** One card of the intake form — a page of its own on the public variant. */
export type IntakeStepId =
  | "primaryContact"
  | "address"
  | "leadSource"
  | "members"
  | "policies";

export interface IntakeStep {
  id: IntakeStepId;
  /**
   * The card's name — its heading on the flat internal form, and the progress
   * header's title on the paginated public one. Never both: on the paginated
   * form the card is a bare panel, the way `SoldDealWizard`'s cards are.
   */
  title: string;
  /**
   * The field paths this card owns, as path **roots** rather than leaves — the
   * same contract as the Sold wizard's `CARD_FIELDS`, and for the same reason:
   * zod reports a blank member row at `members[0].firstName`, which no static
   * list can name. `validateStep` walks every registered path underneath.
   *
   * Typed `DeepKeys` so `form.validateField` takes them with no cast.
   */
  fields: Array<DeepKeys<LeadIntakeFormValues>>;
  /** Which entry points render it. */
  variants: readonly LeadIntakeVariant[];
}

const BOTH_VARIANTS = ["internal", "public"] as const;

/**
 * The cards, in order.
 *
 * Data rather than logic scattered through the JSX: the public form paginates
 * over this list and validates `step.fields` before advancing, so adding a card
 * cannot forget to validate it — and the flat internal form renders the same
 * list top to bottom. One order, one source.
 */
const STEPS: readonly IntakeStep[] = [
  {
    id: "primaryContact",
    title: "Primary contact",
    fields: ["primaryContact"],
    variants: BOTH_VARIANTS,
  },
  {
    id: "address",
    title: "Household address",
    fields: ["address"],
    variants: BOTH_VARIANTS,
  },
  {
    id: "leadSource",
    title: "Lead source",
    fields: ["leadSourceCode"],
    variants: ["internal"],
  },
  {
    // Nothing is required of it — the schema asks only that there be at most
    // 10 — so this page always advances. It is a page anyway: skipping past a
    // card the submitter might want is worse than one extra Next.
    id: "members",
    title: "Additional household members",
    fields: ["members"],
    variants: BOTH_VARIANTS,
  },
  {
    id: "policies",
    title: "Policies of interest",
    fields: ["policiesOfInterest"],
    variants: ["public"],
  },
];

/** The cards this entry point renders, in order. */
export function intakeSteps(variant: LeadIntakeVariant): IntakeStep[] {
  return STEPS.filter((step) => step.variants.includes(variant));
}
