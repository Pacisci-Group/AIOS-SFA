import { z } from 'zod';

/**
 * `POST /agency/setup/complete` (PAC-69).
 *
 * `skipped` records *how* the owner got to the end — filled the white-label step
 * in, or pressed "Skip for now". Both complete the setup; only the second one is
 * worth a nudge later, and the two are otherwise indistinguishable after the
 * fact (an owner may legitimately have left every branding field empty).
 */
export const completeAgencySetupSchema = z.object({
  skipped: z.boolean().optional(),
});

export type CompleteAgencySetupDto = z.infer<typeof completeAgencySetupSchema>;
