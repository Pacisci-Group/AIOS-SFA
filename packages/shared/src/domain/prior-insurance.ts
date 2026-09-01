import { choiceVocabulary } from './choice-vocabulary';

/**
 * Who places the cancellation call on the client's outgoing insurance (PAC-80).
 *
 * ⚠ **The collision.** This field and Prior Policies' "Policy Type" share both a
 * field id (`sb3cc60eb5`) and its codes — SmartSuite clones tables, and the
 * clone kept the original's choice ids while its labels were rewritten. So
 * `XT6s7` means *SFA Call* here and *Auto* there.
 *
 * That makes a single global code→label map actively unsafe, and is the reason
 * every vocabulary in this codebase is scoped to one field. `prior-policy.spec.ts`
 * asserts both meanings simultaneously so the two can never be merged.
 *
 * Labels from `docs/smartsuite-tables/The Prior Insurance Table.md:20`.
 */
export const CANCELLATION_RESPONSIBILITIES = [
  'SFA Call',
  'Customer Call',
] as const;

export type CancellationResponsibility =
  (typeof CANCELLATION_RESPONSIBILITIES)[number];

export const CANCELLATION_RESPONSIBILITY_CODE_ALIASES: Record<
  string,
  CancellationResponsibility
> = {
  XT6s7: 'SFA Call',
  fr4Ge: 'Customer Call',
};

const vocabulary = choiceVocabulary(
  CANCELLATION_RESPONSIBILITIES,
  CANCELLATION_RESPONSIBILITY_CODE_ALIASES,
);

export const normalizeCancellationResponsibility = vocabulary.normalize;
export const cancellationResponsibilityQueryValues = vocabulary.queryValues;
