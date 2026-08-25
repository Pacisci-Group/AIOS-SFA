import { z } from 'zod';

/**
 * `POST /mailers/log-lead` (PAC-61).
 *
 * ## Why this is not `create-lead.dto.ts`
 *
 * That DTO's `person` schema requires a date of birth, a 10-character phone
 * number and a valid email address. A mailer has **none** of the three:
 * `emailaddre` and `birthdate` are empty on 100% of the reference file's 20,405
 * rows and `phone` is populated on 4.4%. Reusing it would 400 roughly 96% of
 * real requests. The service-layer `IntakePerson` has all three optional, which
 * is what makes this path work at all.
 *
 * The body is a control number and nothing else. Everything written to the lead
 * — the recipient, the address, the lead source, the producer — is read from
 * the stored mailer or from the authenticated user, never from the request, so
 * there is nothing here for a caller to influence.
 */
export const logMailerLeadSchema = z.object({
  /**
   * Either printed form of the Quote Control Number, in any case and with any
   * punctuation. Normalized server-side; a value that normalizes to nothing
   * 404s the same way an unknown number does.
   */
  controlNumber: z
    .string()
    .trim()
    .min(1, 'Enter a Quote Control Number.')
    .max(80),
});

export type LogMailerLeadDto = z.infer<typeof logMailerLeadSchema>;
