import { choiceVocabulary } from './choice-vocabulary';

/**
 * The client's outgoing policies, and how their cancellation is progressing
 * (PAC-80).
 *
 * ## Why prior policies get their own policy-type vocabulary
 *
 * `normalizePolicyType` does **not** cover these, and must never be taught to.
 * Prior Policies uses a third, separate code set (`XT6s7`/`fr4Ge`/`RWdTl`) whose
 * codes collide with the Prior *Insurance* table's "Cancellation Responsibility"
 * field — same field id `sb3cc60eb5`, same codes, meaning "SFA Call" and
 * "Customer Call" there (`docs/smartsuite-tables/The Prior Insurance Table.md:20`).
 * Adding `XT6s7 → Auto` to the global map would start rendering a cancellation
 * responsibility as "Auto".
 *
 * That is not hypothetical: `lead-detail.service.ts` already called
 * `normalizePolicyType` on a prior policy. It was harmless only because the
 * global map happened not to contain the code. PAC-80 points that call site here
 * instead, and `prior-policy.spec.ts` pins the collision so a future tidy-up
 * cannot merge the two tables.
 *
 * `Other` is a member here and is not a `PolicyType` — another reason these
 * cannot share a vocabulary.
 */
export const PRIOR_POLICY_TYPES = ['Auto', 'Home', 'Other'] as const;

export type PriorPolicyType = (typeof PRIOR_POLICY_TYPES)[number];

/** `The Prior Policies Table.md:21` — field `sb3cc60eb5`. */
export const PRIOR_POLICY_TYPE_CODE_ALIASES: Record<string, PriorPolicyType> = {
  XT6s7: 'Auto',
  fr4Ge: 'Home',
  RWdTl: 'Other',
};

const typeVocabulary = choiceVocabulary(
  PRIOR_POLICY_TYPES,
  PRIOR_POLICY_TYPE_CODE_ALIASES,
);

export const normalizePriorPolicyType = typeVocabulary.normalize;
export const priorPolicyTypeQueryValues = typeVocabulary.queryValues;

/**
 * How far along the cancellation of a prior policy is.
 *
 * A SmartSuite *status* field, so four of its five codes are the generic
 * workflow slugs (`backlog`, `in_progress`, …) rather than opaque ids — and
 * those same slugs mean entirely different things on other tables (`backlog` is
 * "Submitted" on Time Off Requests and "Open" on Service Tickets). Per-field
 * vocabularies are what keep them apart.
 *
 * Labels from `The Prior Policies Table.md:13`.
 */
export const PRIOR_POLICY_CANCELLATION_STATUSES = [
  'Not Started',
  'In Progress',
  'Submitted',
  'Confirm',
  'Not Needed',
] as const;

export type PriorPolicyCancellationStatus =
  (typeof PRIOR_POLICY_CANCELLATION_STATUSES)[number];

export const PRIOR_POLICY_CANCELLATION_CODE_ALIASES: Record<
  string,
  PriorPolicyCancellationStatus
> = {
  backlog: 'Not Started',
  in_progress: 'In Progress',
  ready_for_review: 'Submitted',
  complete: 'Confirm',
  aFuHB: 'Not Needed',
};

const cancellationVocabulary = choiceVocabulary(
  PRIOR_POLICY_CANCELLATION_STATUSES,
  PRIOR_POLICY_CANCELLATION_CODE_ALIASES,
);

export const normalizePriorPolicyCancellationStatus =
  cancellationVocabulary.normalize;
export const priorPolicyCancellationQueryValues =
  cancellationVocabulary.queryValues;
