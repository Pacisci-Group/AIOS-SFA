import { choiceVocabulary } from './choice-vocabulary';

/**
 * A policy's lifecycle state (PAC-80).
 *
 * The migration stored `selectCode(...)` for this field, so 3,998 of 4,327
 * migrated policies held a raw code (`QsrnM`, `wSd3a`) and rendered it verbatim
 * wherever a policy is shown — `policy-view.ts`, `clients.service.ts`, and the
 * household policy card.
 *
 * There was no canonical vocabulary to normalize against before this; the
 * comment on `policies.service.ts`'s change-log said as much. These labels are
 * SmartSuite's own, from the Policy Status choices documented in
 * `docs/smartsuite-tables/The Policies Table.md:28`, so nothing is invented —
 * and they agree with the two values the app already writes by hand
 * (`'Active'` / `'Cancelled'` in `upsert-policies.step.ts`).
 */
export const POLICY_STATUSES = [
  'Quoted',
  'Active',
  'Cancelled',
  'Pending',
  'Lapsed',
] as const;

export type PolicyStatus = (typeof POLICY_STATUSES)[number];

/** `The Policies Table.md:28` — field `s87f83281a`. */
export const POLICY_STATUS_CODE_ALIASES: Record<string, PolicyStatus> = {
  wSd3a: 'Quoted',
  QsrnM: 'Active',
  hLpfg: 'Cancelled',
  v7ho8: 'Pending',
  uUVZd: 'Lapsed',
};

const vocabulary = choiceVocabulary(POLICY_STATUSES, POLICY_STATUS_CODE_ALIASES);

/**
 * Stored value → display label.
 *
 * ⚠ The migrated data also contains `1943j` and `4krtk`, which appear in **no**
 * table doc — choices added to SmartSuite after the docs were captured. They
 * fall through the passthrough branch and render as themselves, which is the
 * honest outcome: guessing at a status is worse than showing an operator a code
 * they can look up. The migration's `uncatalogued` report line names them with
 * counts so they can be resolved at source and added here.
 */
export const normalizePolicyStatus = vocabulary.normalize;
export const policyStatusQueryValues = vocabulary.queryValues;

/**
 * Is this policy live?
 *
 * An uncatalogued status answers `false`. That is the safe direction: over-
 * reporting a book as active is the error that matters, and the two unknown
 * codes above must not be guessed into "Active".
 */
export function isActivePolicyStatus(raw?: string | null): boolean {
  return normalizePolicyStatus(raw) === 'Active';
}
