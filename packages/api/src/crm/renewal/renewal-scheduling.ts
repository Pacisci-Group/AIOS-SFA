import { RENEWAL_STEP_LABELS } from '@sfa/shared';
import type {
  RenewalStepDefinition,
  RenewalStepKey,
  RenewalTrack,
} from '@sfa/shared';

/**
 * Pure scheduling for renewal-outreach calls.
 *
 * Deliberately free of Mongoose, Nest, and I/O so the timing rules can be
 * unit-tested directly, exactly like `onboarding-scheduling.ts`. All arithmetic
 * is exact elapsed time; there is no business-calendar logic.
 *
 * **This is not a chain, and that is the whole point.**
 *
 * Onboarding's `computeStepTiming` does two things that would be actively wrong
 * here, which is why this is a separate module rather than a reuse:
 *
 *   1. It returns `NOT_SCHEDULABLE` while a predecessor is incomplete. Under
 *      that rule, a client whose 90-day annual review was never made would
 *      never get a 45-day renewal call — but the carrier's paperwork arrives on
 *      its own schedule regardless of whether the warm-up happened.
 *   2. It clamps `availableAt` to `max(anchor + offset, predecessor.completedAt)`.
 *      Under that rule a late annual review would push the renewal call out.
 *      Nothing a CSR does moves the renewal date.
 *
 * So each renewal call is anchored independently to one fixed date owned by the
 * carrier. Both tickets can therefore be planned — and created — up front.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface RenewalStepTiming {
  /** When the call opens for work. */
  availableAt: Date;
  /** When it goes overdue — 48h after opening, by default config. */
  dueAt: Date;
}

/**
 * Timing for one call.
 *
 *     availableAt = renewalDate + offsetMinutes     (offset is NEGATIVE)
 *     dueAt       = availableAt + slaMinutes
 *
 * With the shipped definitions that gives, for a policy renewing on day 0:
 *
 *     annual_review    opens T-90, overdue T-88
 *     renewal_review   opens T-45, overdue T-43
 *     (auto, merged)   opens T-45, overdue T-43
 *
 * Note `dueAt` is *not* clamped to the renewal date. A 48h SLA sits far inside
 * every window, and clamping would quietly mask a misconfigured offset rather
 * than letting it show up as an obviously wrong due date.
 */
export function computeRenewalStepTiming(
  definition: RenewalStepDefinition,
  renewalDate: Date,
): RenewalStepTiming {
  const availableMs =
    renewalDate.getTime() + definition.offsetMinutes * MINUTE_MS;

  return {
    availableAt: new Date(availableMs),
    dueAt: new Date(availableMs + definition.slaMinutes * MINUTE_MS),
  };
}

export interface PlannedRenewalStep extends RenewalStepTiming {
  stepKey: RenewalStepKey;
  label: string;
  sortOrder: number;
  /** 1-based position within this track's calls. */
  sequence: number;
  completedAt: Date | null;
  mergedFrom: readonly RenewalStepKey[];
}

/**
 * Every call on a track, in order, with its timing.
 *
 * Used to plan a cycle: to create both tickets up front, and to render the
 * "Step 1 of 2" chain on the parent record. The track selects the definitions —
 * `semiannual` yields exactly one merged call, `annual` yields two — so no
 * caller ever branches on the policy type to decide how many calls to make.
 *
 * Definitions are sorted defensively: they come from editable config, and a bad
 * `sortOrder` should not silently reorder the outreach.
 */
export function scheduleRenewalSteps(
  definitions: RenewalStepDefinition[],
  track: RenewalTrack,
  renewalDate: Date,
  completedAtByKey: Partial<Record<RenewalStepKey, Date | null>> = {},
): PlannedRenewalStep[] {
  const ordered = definitions
    .filter((definition) => definition.track === track)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return ordered.map((definition, index) => ({
    stepKey: definition.stepKey,
    label: RENEWAL_STEP_LABELS[definition.stepKey] ?? definition.stepKey,
    sortOrder: definition.sortOrder,
    sequence: index + 1,
    completedAt: completedAtByKey[definition.stepKey] ?? null,
    mergedFrom: definition.mergedFrom,
    ...computeRenewalStepTiming(definition, renewalDate),
  }));
}

/**
 * The cycle's identity: the UTC calendar day of its anchor renewal date.
 *
 * Stamped once at creation and never rewritten, so next term's renewal is a
 * different key and therefore a different cycle — while a carrier nudging the
 * date by a few days stays the *same* cycle rather than forking it.
 *
 * UTC deliberately: a local-time key would shift a cycle's identity for anyone
 * reading it from another timezone.
 */
export function formatTermKey(renewalDate: Date): string {
  return renewalDate.toISOString().slice(0, 10);
}

/**
 * What a policy's outreach counts down to.
 *
 * `renewalDate` is the real field, but a good part of the migrated book only
 * carries `expirationDate`, and for a renewing policy the two are the same
 * moment. Returns null when the policy has neither, which makes it ineligible
 * for outreach — there is nothing to count down to.
 */
export function renewalAnchorDate(policy: {
  renewalDate?: Date | string | null;
  expirationDate?: Date | string | null;
}): Date | null {
  const raw = policy.renewalDate ?? policy.expirationDate ?? null;
  if (!raw) {
    return null;
  }
  const parsed = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Whole days from `now` until the renewal, negative once it has passed.
 *
 * Computed server-side and shipped as a number so the browser never does date
 * math — the mock desk's hardcoded `daysUntil` being permanently stale is
 * exactly the failure this avoids.
 */
export function daysUntil(renewalDate: Date, now: Date): number {
  return Math.floor((renewalDate.getTime() - now.getTime()) / DAY_MS);
}
