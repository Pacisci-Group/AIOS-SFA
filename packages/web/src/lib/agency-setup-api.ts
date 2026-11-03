import type { AgencySetupView } from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

/**
 * The agency's first-run setup state (PAC-69).
 *
 * Gated on `agency:branding:read` / `:write` — the same permission as the
 * settings the wizard actually writes, so anyone who can do the work can say
 * they are finished. Callers outside an owner's session must tolerate a 403.
 */
export function getAgencySetup(): Promise<AgencySetupView> {
  return apiFetch<AgencySetupView>('/agency/setup');
}

/** Which steps the owner pressed "Skip for now" on. All complete the setup. */
export interface CompleteAgencySetupInput {
  /** The white-label step. */
  skipped?: boolean;
  /** The two HR phases (PAC-161). */
  calendarSkipped?: boolean;
  hrPolicySkipped?: boolean;
}

/**
 * Mark setup finished.
 *
 * The flags record *how* the owner got to the end — filled a step in, or
 * pressed "Skip for now". Either way the wizard stops being offered —
 * skipping completes, so an owner who is not ready is not nagged on every
 * sign-in.
 *
 * Idempotent server-side, so a double submit is safe.
 */
export function completeAgencySetup(
  input: CompleteAgencySetupInput = {},
): Promise<AgencySetupView> {
  return apiFetch<AgencySetupView>('/agency/setup/complete', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
