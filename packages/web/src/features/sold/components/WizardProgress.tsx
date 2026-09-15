import { Progress } from "@/components/ui/progress";
import { CARD_TITLES, type WizardCard } from "./sold-deal-schema";

interface WizardProgressProps {
  card: WizardCard;
  /**
   * This variant's ordered steps. Passed in rather than read off the module
   * constant, so "Step 4 of 7" counts the steps the user will actually see —
   * a transfer's sequence is not the sale's.
   */
  cards: readonly WizardCard[];
  /** 1-based position of this policy on the sale. */
  position: number;
  /** Replacing a policy already on the sale rather than adding one. */
  editing?: boolean;
}

/**
 * Step indicator for one policy.
 *
 * Built from the existing `Progress` primitive rather than a stepper component:
 * shadcn has none. Counts the policy's own steps only (PAC-104). It used to
 * count the sale's cards too, so the loop sent a producer from "Step 9 of 9"
 * back to "Step 2 of 9" with nothing saying a second policy had begun — naming
 * the policy is what says it now.
 */
export function WizardProgress({
  card,
  cards,
  position,
  editing = false,
}: WizardProgressProps) {
  const step = cards.indexOf(card) + 1;
  const total = cards.length;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          {CARD_TITLES[card]}
        </h2>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {editing ? "Editing policy" : "Policy"} {position} · Step {step} of{" "}
          {total}
        </p>
      </div>
      <Progress value={(step / total) * 100} aria-label="Policy progress" />
    </div>
  );
}
