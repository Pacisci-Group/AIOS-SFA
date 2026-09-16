import { useCallback, useState } from "react";
import {
  cardsFor,
  firstLoopCard,
  type WizardCard,
  type WizardVariant,
} from "./sold-deal-schema";

/**
 * The wizard's step machine.
 *
 * `nextCard` is **pure and exported** so the branching can be tested without
 * React. `packages/web` has no test runner today (`lint` is `tsc --noEmit`);
 * keeping the logic pure is what makes it ready for one rather than something
 * that has to be untangled first.
 */

/**
 * The card after `card`, or `null` at the end of the wizard.
 *
 * Takes the ordered list rather than reading the module constant, because the
 * two variants run different sequences — a transfer has no prior-insurance card
 * and a sale has no from-policy card. Deliberately linear within a list; the
 * loop's non-linearity lives in the history stack below.
 */
export function nextCard(
  card: WizardCard,
  cards: readonly WizardCard[],
): WizardCard | null {
  const index = cards.indexOf(card);
  if (index < 0 || index === cards.length - 1) return null;
  return cards[index + 1];
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

export function useWizardNavigation(
  variant: WizardVariant = "sale",
): WizardNavigation {
  const cards = cardsFor(variant);
  const loopStart = firstLoopCard(variant);

  // A history *stack*, not an index.
  //
  // Back has to undo what actually happened, and the loop makes the path
  // non-linear: after adding a second policy the sequence is
  // 1 → 2 → … → 8 → 2 → … → 8, so "the previous card" is a fact about this
  // session, not something recomputable from the current card's position.
  const [history, setHistory] = useState<WizardCard[]>([cards[0]]);
  const card = history[history.length - 1];

  const advance = useCallback(
    (to?: WizardCard) => {
      setHistory((prev) => {
        const current = prev[prev.length - 1];
        const target = to ?? nextCard(current, cards);
        return target ? [...prev, target] : prev;
      });
    },
    [cards],
  );

  const back = useCallback(() => {
    setHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const restartLoop = useCallback(() => {
    setHistory((prev) => [...prev, loopStart]);
  }, [loopStart]);

  return {
    card,
    atStart: history.length === 1,
    advance,
    back,
    restartLoop,
  };
}
