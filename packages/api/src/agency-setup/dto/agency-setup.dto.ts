import { z } from 'zod';

/**
 * `POST /agency/setup/complete` (PAC-69, PAC-161).
 *
 * `skipped` records *how* the owner got to the end of the white-label step —
 * filled it in, or pressed "Skip for now". `calendarSkipped` and
 * `hrPolicySkipped` say the same for the two HR phases. All three complete
 * the setup; the flags are only what a later nudge keys off, and the three
 * are otherwise indistinguishable after the fact (an owner may legitimately
 * have left every branding field empty, or added no holiday).
 */
export const completeAgencySetupSchema = z.object({
  skipped: z.boolean().optional(),
  calendarSkipped: z.boolean().optional(),
  hrPolicySkipped: z.boolean().optional(),
});

export type CompleteAgencySetupDto = z.infer<typeof completeAgencySetupSchema>;
