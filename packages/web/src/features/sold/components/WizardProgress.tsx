import { Progress } from "@/components/ui/progress";
import {
  CARD_TITLES,
  WIZARD_CARDS,
  type WizardCard,
} from "./sold-deal-schema";

interface WizardProgressProps {
  card: WizardCard;
  /** How many policies are already committed to the submission. */
  policyCount: number;
}

/**
 * Step indicator.
 *
 * Built from the existing `Progress` primitive rather than adding a stepper
 * component: shadcn has none, and a linear stepper would misrepresent this
 * wizard anyway — the loop means a producer can pass "step 4 of 7" several
 * times in one session. The policy count is what actually tells them where they
 * are, so it is shown alongside.
 */
export function WizardProgress({ card, policyCount }: WizardProgressProps) {
  const index = WIZARD_CARDS.indexOf(card);
  const step = index + 1;
  const total = WIZARD_CARDS.length;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          {CARD_TITLES[card]}
        </h2>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Step {step} of {total}
          {policyCount > 0 && (
            <>
              {" · "}
              {policyCount} {policyCount === 1 ? "policy" : "policies"} added
            </>
          )}
        </p>
      </div>
      <Progress value={(step / total) * 100} aria-label="Wizard progress" />
    </div>
  );
}
