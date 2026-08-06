import type {
  CreateActivityResponse,
  LoggableActivityType,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

export type { CreateActivityResponse, LoggableActivityType };

export interface LogActivityInput {
  leadId: string;
  type: LoggableActivityType;
  /** Required for `note` — a note is its text. Defaulted server-side otherwise. */
  summary?: string;
}

/**
 * Log a touch on a lead (PAC-16) — the dashboard's quick actions and the Lead
 * Detail note composer both come through here.
 *
 * **This records a touch; it does not place one.** The `tel:`/`sms:`/`mailto:`
 * anchor does that, and this call says the producer made it.
 */
export function logActivity(input: LogActivityInput) {
  return apiFetch<CreateActivityResponse>('/activities', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
