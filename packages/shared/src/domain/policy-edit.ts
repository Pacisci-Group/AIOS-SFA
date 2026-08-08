/**
 * Sold-policy quick edit (PAC-56 #27) — `PATCH /policies/:id`.
 *
 * David asked for a Sold card on the Lead Detail page "allowing quick edits to
 * sold policies". Legacy had this as a whole second Fillout form (the Deals
 * `Edit Sold` formula → form `782Dc42qhSus`); this is deliberately narrower —
 * the fields a producer gets wrong at the keyboard and needs to correct without
 * re-running an 8-card wizard.
 *
 * Two fields are **not** here on purpose:
 *
 * - **`active`.** `Household.totalActivePolicies` is a stored roll-up that
 *   nothing recomputes on write. Letting this endpoint flip `active` would
 *   silently drift the household's own count away from its policies. Retiring a
 *   policy is a lifecycle event that should maintain the roll-up, not a typo fix.
 * - **`householdId` / `dealId`.** Re-parenting a policy is a merge operation,
 *   not an edit, and would move a record between producers' books.
 */

import type { LeadDetailPolicy } from './lead-detail';

/**
 * `PATCH /policies/:id`. At least one field must be present.
 *
 * `null` clears an optional field; omitting it leaves the stored value alone.
 * The two are distinct — a producer blanking a mistyped carrier is not the same
 * request as one who only touched the premium.
 */
export interface UpdatePolicyInput {
  /**
   * Re-normalized server-side into `policyNumberKey`, so `GET /policies/check`
   * keeps finding the policy after a correction.
   *
   * Deliberately **not** checked for uniqueness: `PolicySchema` is non-unique on
   * purpose (migrated duplicates, and carriers legitimately reuse numbers) — see
   * the comment on its index. Warn-and-link is the product behaviour, and it
   * belongs on the create path, not here.
   */
  policyNumber?: string | null;
  /** A canonical policy-type label; normalized on the way in. */
  policyType?: string;
  carrier?: string | null;
  premium?: number;
  items?: number;
  /** `YYYY-MM-DD` calendar dates, not instants. */
  effectiveDate?: string | null;
  expirationDate?: string | null;
  /**
   * Free text, not a vocabulary.
   *
   * There is no canonical policy-status list anywhere in the platform: migrated
   * policies carry raw SmartSuite values and nothing has ever written one from
   * the app. Constraining it here would reject the values already in the
   * collection.
   */
  status?: string | null;
}

/**
 * The saved policy in its server-canonical form — the same shape the Lead
 * Detail page already renders, so the client swaps the row in place rather than
 * refetching the whole 360° assembly for a one-field correction.
 */
export type UpdatePolicyResult = LeadDetailPolicy;
