/**
 * Operator-driven agency onboarding (PAC-69) — the wire contract shared by
 * `POST /platform/agencies` and the Super Admin panel's wizard.
 *
 * ## Why this lives in `shared`
 * The wizard validates the same rules the API enforces (slug shape, which
 * modules start enabled), and the two drifting is exactly how a form that
 * passes client-side validation starts 400ing. The zod schema itself stays on
 * the API — zod is not a dependency of every consumer of this package — but the
 * *rules* it is built from are here.
 *
 * ## "Onboarding" is overloaded in this codebase
 * `ModuleKey.Onboardings`, `crm/onboarding/` and `HouseholdOnboarding` are all
 * about onboarding a **customer's policy**. This file is about standing up a
 * **tenant**. Server-side names deliberately say *provisioning* (creating the
 * agency) and *agency setup* (the owner's own first-run wizard) to keep the two
 * apart; only the product-facing route says "onboard".
 */

import { ModuleKey } from '../enums/module-key.enum';
import type { StructuredAddress } from './address';

/**
 * A slug is a DNS label in waiting.
 *
 * `Agency.slug` is `lowercase: true` with no format constraint, so nothing
 * today stops `"Acme Insurance "` being stored. It becomes the agency's
 * subdomain the moment they add one (`agencyDomains`), and a label with a space
 * in it is not recoverable without a rename that breaks every stored reference.
 */
export const AGENCY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const AGENCY_SLUG_MIN_LENGTH = 2;
export const AGENCY_SLUG_MAX_LENGTH = 50;

/** What the first branch is called when the operator does not say otherwise. */
export const DEFAULT_BRANCH_NAME = 'Main';

/**
 * The modules a newly onboarded agency starts with, pre-selected in the wizard
 * and applied by the API when the operator does not adjust them.
 *
 * This was the hard-coded list inside `PlatformService.createAgency`. It is
 * here so the checkboxes the operator sees and the entitlements the server
 * writes are the same set by construction — a pre-selection that disagreed with
 * the server default would be a silent, per-tenant difference nobody would
 * notice until a nav item was missing.
 */
export const ONBOARDING_DEFAULT_MODULES: readonly ModuleKey[] = [
  ModuleKey.Dashboard,
  ModuleKey.Management,
  ModuleKey.OwnerDashboard,
  ModuleKey.Leads,
  ModuleKey.Clients,
  ModuleKey.Performance,
];

/** `GET /platform/agencies/availability` — live checks for the wizard's fields. */
export interface AgencyAvailabilityResponse {
  /** `null` when the parameter was not supplied. */
  slugAvailable: boolean | null;
  /**
   * `User.email` is unique **platform-wide**, not per agency, so this answers
   * "is this address free anywhere on the platform" — the wizard's copy has to
   * say so, or an operator will go looking in the wrong tenant.
   */
  emailAvailable: boolean | null;
  tickerAvailable: boolean | null;
}

/**
 * Whether the owner's invite email was handed to the async platform.
 *
 * `failed` is **not** a failed onboarding: the tenant exists and is correct,
 * and the operator can resend. It is reported rather than thrown because
 * rolling the tenant back on a delivery error is the one thing this endpoint
 * must never do — the event may already have been recorded and will be replayed
 * by the event-log sweep, which would mail a link to a deleted account.
 */
export type OwnerInviteEmailStatus = 'queued' | 'failed';

export interface OnboardAgencyResponse {
  agency: { id: string; name: string; slug: string };
  branch: { id: string; name: string };
  owner: {
    userId: string;
    email: string;
    /** Absolute, built from the agency's own host. */
    inviteUrl: string;
    /** ISO-8601. */
    expiresAt: string;
    emailStatus: OwnerInviteEmailStatus;
    /**
     * Present outside production only, so the flow can be walked locally
     * without a mail transport. Same predicate as `POST /users/invite`.
     */
    inviteToken?: string;
  };
}

/**
 * Where an agency is in its own first-run setup (PAC-69 phase 2).
 *
 * `complete` is the default for every agency that was not created through the
 * panel — migrated, seeded and test tenants have nothing to be walked through,
 * and defaulting the other way would push every existing owner into a wizard
 * the day this shipped.
 */
export type AgencySetupStatus = 'pending' | 'complete';

export interface AgencySetupView {
  status: AgencySetupStatus;
  /** ISO-8601, or `null` while pending. */
  completedAt: string | null;
  /** Whether the owner skipped the white-label step rather than filling it in. */
  brandingSkipped: boolean;
}
