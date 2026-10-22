import { z } from 'zod';
import { timeZoneSchema } from '../../common/dates/time-zone.schema';

/**
 * The end-of-day hour as the API accepts it (PAC-149): a whole hour on the
 * agency's clock, `0`–`23`. A number, not a numeric string — the web sends a
 * number, and `z.coerce` would wave through `"20"`, `true` and `""` (as `0`).
 * Whole hours only, because the sweep ticks every thirty minutes; see
 * `Agency.endOfDayHour`.
 */
export const endOfDayHourSchema = z
  .number({ message: 'Choose an hour.' })
  .int('Choose a whole hour.')
  .min(0, 'Choose an hour between 12:00 AM and 11:00 PM.')
  .max(23, 'Choose an hour between 12:00 AM and 11:00 PM.');

/**
 * `PATCH /agency/profile` (PAC-141, PAC-149).
 *
 * The agency's working day: its time zone and the hour everyone is set Away.
 * Both optional, at least one required — a body naming neither is a client
 * bug, and answering it with a 200 would let the page report a save that
 * changed nothing. The endpoint is named for what it holds — the facts about
 * the agency itself that its owner may edit, as opposed to branding (how it
 * looks), domains (where it lives) or email (how it writes) — so the next
 * such fact (PAC-148's working days) lands here rather than on another page.
 */
export const updateAgencyProfileSchema = z
  .object({
    timezone: timeZoneSchema.optional(),
    endOfDayHour: endOfDayHourSchema.optional(),
  })
  .refine(
    (body) => body.timezone !== undefined || body.endOfDayHour !== undefined,
    { message: 'Send a timezone, an endOfDayHour, or both.' },
  );

export type UpdateAgencyProfileDto = z.infer<typeof updateAgencyProfileSchema>;
