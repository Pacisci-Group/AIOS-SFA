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

/**
 * Mark setup finished.
 *
 * `skipped` records that the owner pressed "Skip for now" rather than filling
 * the white-label step in. Either way the wizard stops being offered — skipping
 * completes, so an owner who is not ready is not nagged on every sign-in.
 *
 * Idempotent server-side, so a double submit is safe.
 */
export function completeAgencySetup(
  input: { skipped?: boolean } = {},
): Promise<AgencySetupView> {
  return apiFetch<AgencySetupView>('/agency/setup/complete', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
