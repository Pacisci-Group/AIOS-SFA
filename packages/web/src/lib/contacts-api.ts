import type { ContactDetail, UpdateContactInput } from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

export type { ContactDetail, UpdateContactInput };

/**
 * `PATCH /contacts/:id` — the "Edit Primary Contact" modal on the Lead Detail
 * page (PAC-38).
 *
 * Gated on `clients:write`, **not** `leads:write`: a contact is a CRM record
 * shared across the household, so its writes belong to the `clients` module.
 * PAC-38 added that permission to the Producer role template; check with
 * `canWrite(ModuleKey.Clients)` before rendering the trigger.
 *
 * `null` on `dateOfBirth` / `email` / `phone` clears the field — the form sends
 * that for a field the producer emptied, which is different from omitting it.
 */
export function updateContact(contactId: string, input: UpdateContactInput) {
  return apiFetch<ContactDetail>(`/contacts/${encodeURIComponent(contactId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
