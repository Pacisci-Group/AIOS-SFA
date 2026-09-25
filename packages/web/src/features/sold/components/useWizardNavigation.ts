import { useCallback, useState } from "react";
import type { WizardCard } from "./sold-deal-schema";

export interface WizardNavigation {
  card: WizardCard;
  /** On the first step — Back then leaves the policy rather than stepping. */
  atStart: boolean;
  /** On the last step — its button commits the policy instead of advancing. */
  atEnd: boolean;
  advance: () => void;
  back: () => void;
}

/**
 * The step machine for one policy (PAC-104).
 *
 * ## An index, not the history stack this used to be
 *
 * The stack existed for the add-another loop, which made the path non-linear —
 * `… → prior insurance → policy type → …` — so "the previous card" was a fact
 * about the session rather than about the current position. The loop is gone:
 * a `PolicyDraftStepper` is mounted per policy and walks its variant's steps in
 * order, so the position *is* the history.
 *
 * Takes the ordered list rather than reading the module constant, because the
 * two variants run different sequences — a replacement has no prior-insurance
 * card (PAC-126).
 */
export function useWizardNavigation(
  cards: readonly WizardCard[],
): WizardNavigation {
  const [index, setIndex] = useState(0);
  const last = cards.length - 1;

  const advance = useCallback(
    () => setIndex((current) => Math.min(current + 1, last)),
    [last],
  );
  const back = useCallback(
    () => setIndex((current) => Math.max(current - 1, 0)),
    [],
  );

  return {
    card: cards[index],
    atStart: index === 0,
    atEnd: index === last,
    advance,
    back,
  };
}
