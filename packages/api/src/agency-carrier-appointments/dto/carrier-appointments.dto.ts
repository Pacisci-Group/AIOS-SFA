import { z } from 'zod';

/**
 * `PUT /agency/carrier-appointments` (PAC-93).
 *
 * ## No transforms
 *
 * Same convention `onboard-agency.dto.ts` states: values reach the service
 * exactly as the caller sent them, so an error can never name a value the
 * caller never typed. Trimming and `codeKey` derivation happen in
 * `AgencyCarrierAppointmentsService`.
 *
 * ## Why the code is optional
 *
 * The code is optional at every point it can be entered — the Super Admin picks
 * the carriers when onboarding a tenant and may leave the codes for the owner,
 * who supplies them during first-run setup or later under Workspace Settings.
 * The wizard, the setup step and the settings page therefore all send the same
 * row shape, and the service does the one thing with an incomplete row: drops
 * it.
 */

/**
 * A 24-hex ObjectId. Validated here rather than left to Mongoose so a malformed
 * id is a 400 naming the field, not a 500 out of a cast.
 */
const objectId = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{24}$/i, 'Choose a carrier from the list.');

export const carrierAppointmentSchema = z.object({
  carrierId: objectId,
  carrierAgencyCode: z.string().trim().max(40).optional(),
  isPrimary: z.boolean().optional(),
  active: z.boolean().optional(),
});

export const replaceCarrierAppointmentsSchema = z.object({
  /**
   * A cap, not a business rule. No agency is appointed by 20 carriers, and an
   * unbounded array on a `$set` is a denial-of-service shape.
   */
  appointments: z.array(carrierAppointmentSchema).max(20),
});

export type CarrierAppointmentDto = z.infer<typeof carrierAppointmentSchema>;
export type ReplaceCarrierAppointmentsDto = z.infer<
  typeof replaceCarrierAppointmentsSchema
>;
