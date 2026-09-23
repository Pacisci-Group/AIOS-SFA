/**
 * A user's own "am I taking leads right now" switch (PAC-139 §6).
 *
 * Set by the user themself from the sidebar, read by the Manager view's Team
 * Activity table and by the Command Center's "assign to" picker (PAC-138),
 * which lists only people who are `available`. Nothing computes it: there is
 * no "idle" derived from inactivity and no automatic flip on log-out, because
 * David asked for a status a person *sets*, and a value the app changes behind
 * someone's back is a value nobody trusts.
 *
 * Two values for now — David named the behaviour ("from active to take leads
 * if they're busy") but not the vocabulary, and this is the smallest set that
 * carries it. `busy` means *not taking leads*, nothing about being logged in.
 * A third state tied to approved time off is a plausible later addition; add
 * it here, never as a string elsewhere.
 */
export const USER_AVAILABILITIES = ['available', 'busy'] as const;
export type UserAvailability = (typeof USER_AVAILABILITIES)[number];

/** Every account starts available — the switch is for opting *out*. */
export const DEFAULT_USER_AVAILABILITY: UserAvailability = 'available';

export const USER_AVAILABILITY_LABELS: Record<UserAvailability, string> = {
  available: 'Available',
  busy: 'Busy',
};

/** What each state means, for the control that sets it. */
export const USER_AVAILABILITY_DESCRIPTIONS: Record<UserAvailability, string> =
  {
    available: 'Taking new leads',
    busy: 'Not taking new leads',
  };

export function isUserAvailability(value: unknown): value is UserAvailability {
  return (
    typeof value === 'string' &&
    (USER_AVAILABILITIES as readonly string[]).includes(value)
  );
}
