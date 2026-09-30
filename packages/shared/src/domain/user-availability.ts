/**
 * A user's own presence switch: Available, Busy or Away (PAC-139 §6 + §6a).
 *
 * Set by the user themself from the sidebar, read by the Manager view's Team
 * Activity table and by the Command Center's "assign to" picker (PAC-138),
 * which lists only people who are `available`.
 *
 * One job writes it besides the user: the worker's `SetUsersAwayFn` flips
 * every active user of an agency to `away` at 8 PM in the agency's timezone
 * (`Agency.timezone`, §6a). Nobody is flipped back — each person sets
 * themself `available` again when they start work. That is the *only*
 * automatic write: there is still no "idle" derived from inactivity and no
 * flip on log-out, because a value the app changes behind someone's back is a
 * value nobody trusts, and one nightly rule everyone can predict is not that.
 *
 * `busy` means *not taking leads*; `away` means *out of office*. Both are
 * hidden from "assign to"; they differ in what the person is telling their
 * manager. Add a state here, never as a string elsewhere — the API's PATCH
 * body, the badge and the seed all derive from this list.
 */
export const USER_AVAILABILITIES = ['available', 'busy', 'away'] as const;
export type UserAvailability = (typeof USER_AVAILABILITIES)[number];

/** Every account starts available — the switch is for opting *out*. */
export const DEFAULT_USER_AVAILABILITY: UserAvailability = 'available';

/**
 * What the end-of-day sweep sets (§6a). Named so the worker function, the
 * migration notes and the tests cannot disagree about which state "out of
 * office" is.
 */
export const END_OF_DAY_USER_AVAILABILITY: UserAvailability = 'away';

/**
 * The menu shows these names and nothing else — David asked for the
 * explanatory line under each option to go (25 Sep), so there is no
 * descriptions map to keep in step with this one.
 */
export const USER_AVAILABILITY_LABELS: Record<UserAvailability, string> = {
  available: 'Available',
  busy: 'Busy',
  away: 'Away',
};

export function isUserAvailability(value: unknown): value is UserAvailability {
  return (
    typeof value === 'string' &&
    (USER_AVAILABILITIES as readonly string[]).includes(value)
  );
}
