import { z } from 'zod';
import { timeZoneSchema } from '../../common/dates/time-zone.schema';

/**
 * `PATCH /agency/profile` (PAC-141).
 *
 * One field today. The endpoint is named for what it will hold — the facts
 * about the agency itself that its owner may edit, as opposed to branding
 * (how it looks), domains (where it lives) or email (how it writes) — so the
 * next such fact lands here rather than on a fourth settings page.
 */
export const updateAgencyProfileSchema = z.object({
  timezone: timeZoneSchema,
});

export type UpdateAgencyProfileDto = z.infer<typeof updateAgencyProfileSchema>;
