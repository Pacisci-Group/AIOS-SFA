import { useCallback, useState } from "react";
import { WIZARD_CARDS, type WizardCard } from "./sold-deal-schema";

/**
 * The wizard's step machine.
 *
 * `nextCard` and `firstLoopCard` are **pure and exported** so the branching can
 * be tested without React. `packages/web` has no test runner today (`lint` is
 * `tsc --noEmit`); keeping the logic pure is what makes it ready for one rather
 * than something that has to be untangled first.
 */

/** Where every loop iteration begins. */
export const FIRST_LOOP_CARD: WizardCard = "policyType";

/**
 * The card after `card`, or `null` at the end of the wizard.
 *
 * Deliberately linear today. A conditional hop would be the first genuinely
 * conditional hop — the escrow sub-card only exists when escrow was ticked —
 * which is why this is a function rather than an index bump at the call site.
 */
export function nextCard(card: WizardCard): WizardCard | null {
  const index = WIZARD_CARDS.indexOf(card);
  if (index < 0 || index === WIZARD_CARDS.length - 1) return null;
  return WIZARD_CARDS[index + 1];
}

export interface WizardNavigation {
  card: WizardCard;
  /** True when nothing precedes the current card — hides "Back". */
  atStart: boolean;
  advance: (to?: WizardCard) => void;
  back: () => void;
  /** Restart the loop at its first card, for the next policy. */
  restartLoop: () => void;
}

export function useWizardNavigation(): WizardNavigation {
  // A history *stack*, not an index.
  //
  // Back has to undo what actually happened, and the loop makes the path
  // non-linear: after adding a second policy the sequence is
  // 1 → 2 → … → 8 → 2 → … → 8, so "the previous card" is a fact about this
  // session, not something recomputable from the current card's position.
  const [history, setHistory] = useState<WizardCard[]>([WIZARD_CARDS[0]]);
  const card = history[history.length - 1];

  const advance = useCallback((to?: WizardCard) => {
    setHistory((prev) => {
      const current = prev[prev.length - 1];
      const target = to ?? nextCard(current);
      return target ? [...prev, target] : prev;
    });
  }, []);

  const back = useCallback(() => {
    setHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const restartLoop = useCallback(() => {
    setHistory((prev) => [...prev, FIRST_LOOP_CARD]);
  }, []);

  return {
    card,
    atStart: history.length === 1,
    advance,
    back,
    restartLoop,
  };
}
