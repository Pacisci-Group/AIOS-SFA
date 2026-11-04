import type { HrPolicySummary, PersonProfileView } from "@sfa/shared";

/**
 * What the onboarding and Add-to-policy sheets need to know about a policy
 * in relation to one person (PAC-162): the kind it moves people within, and
 * which policy of that kind the person is in today.
 */

/** The one-per-person key: the type, or the time off kind. Custom never moves anyone. */
export function policyKind(policy: HrPolicySummary): string | null {
  if (policy.type !== "time_off") return policy.type;
  return policy.timeOff.timeOffType === "custom"
    ? null
    : `time_off:${policy.timeOff.timeOffType}`;
}

/** The ids of every policy the person is in, per the profile. */
export function currentPolicyIds(profile: PersonProfileView): Set<string> {
  const ids = new Set<string>();
  for (const policy of profile.timeOff?.policies ?? []) ids.add(policy.id);
  if (profile.schedule?.workWeek) ids.add(profile.schedule.workWeek.id);
  if (profile.schedule?.holiday) ids.add(profile.schedule.holiday.id);
  return ids;
}

/** The policy of `kind` the person is in today, by name, if any. */
export function currentOfKind(
  profile: PersonProfileView,
  policies: readonly HrPolicySummary[],
  kind: string | null,
): { id: string; name: string } | null {
  if (!kind) return null;
  const mine = currentPolicyIds(profile);
  const match = policies.find((policy) => mine.has(policy.id) && policyKind(policy) === kind);
  return match ? { id: match.id, name: match.name } : null;
}
