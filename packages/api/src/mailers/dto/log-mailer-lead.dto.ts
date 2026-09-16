import { z } from 'zod';
import { primaryContactDetailsFields } from '../../leads/dto/create-lead.dto';

/**
 * `POST /mailers/log-lead` (PAC-61, PAC-103).
 *
 * ## Where each field comes from
 *
 * The **recipient name, address, lead source and producer** are read from the
 * stored mailer or from the authenticated user, never from the request — there
 * is nothing here for a caller to influence about *who* the mail went to.
 *
 * The **date of birth, phone and email** come from the producer. A mailer
 * almost never has them (`emailaddre` and `birthdate` are empty on 100% of the
 * reference file's 20,405 rows, `phone` populated on 4.4%), and without them
 * the contact cannot pass the PAC-91 §9 duplicate check, so a returning mailer
 * recipient would become a second contact. The drawer asks for them before the
 * lead is created (PAC-103), pre-filled from whatever the mailer does carry.
 * They use the same rules as `POST /leads` so the two paths cannot drift.
 *
 * Still not `create-lead.dto.ts` itself: that one takes a name, an address and
 * a lead source, all of which this route deliberately refuses to accept.
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
  ...primaryContactDetailsFields,
});

export type LogMailerLeadDto = z.infer<typeof logMailerLeadSchema>;
