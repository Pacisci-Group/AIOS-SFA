/**
 * Lead temperature (PAC-36).
 *
 * A hybrid system: a new lead starts "Hot", and the office manager moves it to
 * Warm/Cold during weekly reviews. Automated logic derived from activity and
 * creation time is a later ticket — for now the stored `leads.temperature`
 * field is the source of truth for both display and filtering.
 */
export const LEAD_TEMPERATURES = ['Hot', 'Warm', 'Cold', 'Unknown'] as const;

export type LeadTemperature = (typeof LEAD_TEMPERATURES)[number];

/** The temperatures a user can filter by — `Unknown` is a display state, not a choice. */
export const LEAD_TEMPERATURE_OPTIONS: readonly LeadTemperature[] = [
  'Hot',
  'Warm',
  'Cold',
];
