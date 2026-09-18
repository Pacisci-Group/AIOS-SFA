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
 * comment on `policies.service.ts`'s change-log said as much. The first five
 * labels are SmartSuite's own, from the Policy Status choices documented in
 * `docs/smartsuite-tables/The Policies Table.md:28`, so nothing is invented —
 * and they agree with the two values the app already writes by hand
 * (`'Active'` / `'Cancelled'` in `upsert-policies.step.ts`).
 *
 * The last two are **not** in that doc. They were asked for by David on
 * 2026-09-11 (PAC-126) so service staff can record what actually happened to a
 * policy, and they are app-side additions with no known SmartSuite code — see
 * the ⚠ on {@link normalizePolicyStatus} for why that is an open question
 * rather than a gap to fill in by guessing.
 *
 * ⚠ **These two still carry no *lifecycle* semantics.** What they mean for the
 * renewal scan and the chargeback path is still with David (PAC-126); resolve
 * that before anything starts reading them for more than display.
 *
 * Display is settled, though: the household card's status pill
 * (`policy-display.ts`) renders both as **Cancelled**, not *Lapsed*. Both are
 * cancellations with a replacement behind them, and calling either one a lapse
 * read as lost business on a household that never left.
 */
export const POLICY_STATUSES = [
  'Quoted',
  'Active',
  'Cancelled',
  'Pending',
  'Lapsed',
  'Cancel Rewrite',
  'Company Transfer',
] as const;

export type PolicyStatus = (typeof POLICY_STATUSES)[number];

/**
 * Statuses that cannot be *set* by hand, because setting one is not a status
 * change — it is the outcome of a flow that writes other records too.
 *
 * `'Cancel Rewrite'` means "cancelled, and here is the policy that replaced it".
 * A policy cannot hold it without that replacement existing, so the only thing
 * allowed to write it is the rewrite transaction itself
 * (`UpsertPoliciesStep.retireTransferred`, driven by `POST /policies/:id/rewrite`).
 * Offering it in a dropdown would let an operator produce a cancelled policy
 * pointing at nothing, with a chargeback nobody raised.
 *
 * `'Company Transfer'` is the same shape one flow along — written by the CSR's
 * Policy Transfer, which also writes the replacement and the ticket record.
 */
export const FLOW_ONLY_POLICY_STATUSES: readonly PolicyStatus[] = [
  'Cancel Rewrite',
  'Company Transfer',
];

const FLOW_ONLY_SET = new Set<string>(FLOW_ONLY_POLICY_STATUSES);

/** Is this a status only a flow may write? Normalizes first. */
export function isFlowOnlyPolicyStatus(raw?: string | null): boolean {
  return FLOW_ONLY_SET.has(normalizePolicyStatus(raw));
}

/**
 * What the status select offers (PAC-126).
 *
 * The counterpart of `POLICY_TYPE_OPTIONS`: no status here is a data-integrity
 * artefact, and hiding one would only push staff to pick a wrong neighbour. The
 * two uncatalogued migrated codes are deliberately **not** offered — a code is
 * not a choice, and the select's placeholder is how a policy holding one asks to
 * be given a real status.
 *
 * ⚠ This used to be every status. {@link FLOW_ONLY_POLICY_STATUSES} are now
 * filtered out — not hidden as a UI nicety, but because the API rejects them on
 * `PATCH`, and an option that always 400s is worse than no option.
 */
export const POLICY_STATUS_OPTIONS: readonly PolicyStatus[] =
  POLICY_STATUSES.filter((status) => !FLOW_ONLY_SET.has(status));

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
 *
 * ⚠ **Two undocumented codes, two labels added later (PAC-126) — resist the
 * arithmetic.** `'Cancel Rewrite'` and `'Company Transfer'` arrived from David
 * as the statuses staff need, and it is tempting to conclude they *are* these
 * codes. They are not aliased here because nobody has checked at source, and a
 * wrong alias would relabel thousands of live policies rather than merely
 * showing an operator something opaque. Confirm in SmartSuite first; if they
 * match, aliasing them heals every migrated row in one line.
 */
export const normalizePolicyStatus = vocabulary.normalize;
export const policyStatusQueryValues = vocabulary.queryValues;

/**
 * Does this resolve to one of {@link POLICY_STATUSES}?
 *
 * The write-side counterpart of {@link normalizePolicyStatus}: reads pass an
 * uncatalogued value through so an operator can see it, but a *client* has no
 * business sending one. `PATCH` normalizes first and then asks this, so
 * `'active'` and `'QsrnM'` are accepted and healed while a typo is rejected.
 */
export const isCanonicalPolicyStatus = vocabulary.isCanonical;

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

/**
 * Statuses that mean the policy is off the books.
 *
 * `Policy.active` is the flag every count, total and renewal scan reads;
 * `policyStatus` is the human-facing label. Until now nothing kept them in step
 * on the edit path — `PATCH /policies/:id` set the label and left the flag
 * alone, so a policy could read "Cancelled" while still counting towards the
 * household's active total and being scheduled for renewal calls.
 * {@link policyActiveForStatus} is what closes that.
 *
 * `'Quoted'` and `'Pending'` are deliberately **not** here. Neither is a live
 * policy, but neither is terminal either, and flipping `active` off for them
 * would quietly retire a policy that is merely waiting for the carrier.
 */
export const TERMINAL_POLICY_STATUSES: readonly PolicyStatus[] = [
  'Cancelled',
  'Lapsed',
  'Cancel Rewrite',
  'Company Transfer',
];

const TERMINAL_SET = new Set<string>(TERMINAL_POLICY_STATUSES);

/** Is this status one the policy does not come back from? Normalizes first. */
export function isTerminalPolicyStatus(raw?: string | null): boolean {
  return TERMINAL_SET.has(normalizePolicyStatus(raw));
}

/**
 * What `Policy.active` should become for a status an operator just picked, or
 * `null` to leave it alone.
 *
 * Three answers rather than two, and the third is the important one:
 *
 *   - **`false`** for a terminal status — the policy is off the books.
 *   - **`true`** for `'Active'` — reinstating is a real correction, and a
 *     status of Active on an inactive policy is the same contradiction in
 *     reverse.
 *   - **`null`** for everything else, including every uncatalogued migrated
 *     code. `'Quoted'` and `'Pending'` genuinely do not determine the flag, and
 *     a code nobody has catalogued must not be guessed into either answer.
 */
export function policyActiveForStatus(raw?: string | null): boolean | null {
  const status = normalizePolicyStatus(raw);
  if (isTerminalPolicyStatus(status)) return false;
  if (isActivePolicyStatus(status)) return true;
  return null;
}
