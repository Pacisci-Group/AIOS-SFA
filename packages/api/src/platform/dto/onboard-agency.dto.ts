import {
  AGENCY_SLUG_MAX_LENGTH,
  AGENCY_SLUG_MIN_LENGTH,
  AGENCY_SLUG_PATTERN,
  DEFAULT_BRANCH_NAME,
  ModuleKey,
} from '@sfa/shared';
import { z } from 'zod';

/**
 * `POST /platform/agencies` — onboard a whole tenant (PAC-69).
 *
 * ## Why this replaced an inline body type
 * The route used to take `@Body() body: { name: string; slug: string }`. The
 * global `ValidationPipe` runs `whitelist` + `forbidNonWhitelisted` off a DTO's
 * metadata, and an inline type has none — so nothing was validated, and a slug
 * with a space in it was stored happily. Same trap `ResetPasswordDto`'s docblock
 * records.
 *
 * ## No transforms
 * Values reach the service exactly as the caller sent them, per the convention
 * `agency-domains/dto` states: a `.transform()` would mean the error message
 * names a value the caller never typed. Lowercasing and slug derivation happen
 * in `AgencyProvisioningService`.
 *
 * The two `.default()`s below are not that — they fill in a field the caller
 * *omitted* rather than rewriting one they sent, so nothing is ever reported
 * back under a value the caller did not type. (The absolute ban lives on the
 * Inngest event schemas, where input and output types must match; DTOs only
 * inherit the reasoning.)
 */

/**
 * The slug is a DNS label in waiting — it becomes the agency's subdomain the
 * moment they add one — so it is constrained here rather than left to
 * `Agency.slug`'s bare `lowercase: true`.
 */
const agencySlug = z
  .string()
  .trim()
  .min(AGENCY_SLUG_MIN_LENGTH, 'A slug needs at least two characters.')
  .max(AGENCY_SLUG_MAX_LENGTH, 'That slug is too long.')
  .regex(
    AGENCY_SLUG_PATTERN,
    'Use lowercase letters, numbers and single hyphens — for example acme-insurance.',
  );

const personName = (label: string) =>
  z.string().trim().min(1, `${label} is required.`).max(100);

/**
 * Both mailer identity fields (PAC-73), optional and uppercase.
 *
 * An agency provisioned without them imports no mailers and warns on every RTP
 * upload, so the wizard asks — but an agency that will never run a mail campaign
 * should not be blocked on inventing one.
 */
const ticker = z.string().trim().min(1).max(8).optional();

/**
 * The carriers appointing this agency, and the code each issued (PAC-93).
 *
 * **The same row shape `PUT /agency/carrier-appointments` takes**, code
 * optional, so the wizard, the owner's setup step and the settings page all
 * send one thing and `AgencyCarrierAppointmentsService` does the deciding. An
 * operator who knows the agency is an Allstate agent but not its code picks the
 * carrier and moves on; the owner supplies the code during their own setup.
 *
 * A row with no code stores nothing — see the service. That keeps
 * `carrierAgencyCode` required *inside* the stored appointment, which is what
 * makes the unique index safe.
 */
const carrierAppointments = z
  .array(
    z.object({
      carrierId: z
        .string()
        .trim()
        .regex(/^[a-f0-9]{24}$/i, 'Choose a carrier from the list.'),
      carrierAgencyCode: z.string().trim().max(40).optional(),
      isPrimary: z.boolean().optional(),
      active: z.boolean().optional(),
    }),
  )
  .max(20)
  .default([]);

/**
 * National Producer Number. Optional, carrier-independent, and nothing reads it
 * yet — onboarding is simply the only place anyone will type it.
 */
const npn = z.string().trim().min(1).max(20).optional();

/**
 * The address line is not required.
 *
 * The operator is standing up a tenant, not filing a compliance record, and
 * nothing in the app reads `Branch.address` yet. Requiring a full address would
 * block onboarding on a detail the operator may not have to hand — see
 * `BranchAddress`.
 */
const branchAddress = z.object({
  street: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(60).optional(),
  zip: z.string().trim().max(20).optional(),
});

export const onboardAgencySchema = z.object({
  agency: z.object({
    name: z.string().trim().min(2, 'An agency name is required.').max(120),
    slug: agencySlug,
    ticker,
    carrierAppointments,
    npn,
  }),
  branch: z.object({
    name: z
      .string()
      .trim()
      .min(1, 'A branch name is required.')
      .max(80)
      .default(DEFAULT_BRANCH_NAME),
    address: branchAddress.default({}),
  }),
  /**
   * Which modules this tenant gets. The wizard pre-selects
   * `ONBOARDING_DEFAULT_MODULES`; an empty array is a legitimate (if unhelpful)
   * choice and is accepted, because the operator can toggle modules afterwards
   * and refusing it would be inventing a rule the product does not have.
   */
  modules: z.array(z.nativeEnum(ModuleKey)),
  owner: z.object({
    firstName: personName('First name'),
    lastName: personName('Last name'),
    email: z.string().trim().email('Enter a valid email address.').max(160),
  }),
});

export type OnboardAgencyDto = z.infer<typeof onboardAgencySchema>;

/**
 * `GET /platform/agencies/availability` — every field optional, because the
 * wizard checks each one as it is left rather than all three at once.
 */
export const agencyAvailabilitySchema = z
  .object({
    slug: z.string().trim().max(AGENCY_SLUG_MAX_LENGTH).optional(),
    email: z.string().trim().max(160).optional(),
    ticker: z.string().trim().max(8).optional(),
    /**
     * A carrier agency code is only meaningful inside its carrier, so the pair
     * is checked together or not at all (PAC-93).
     */
    carrierId: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{24}$/i)
      .optional(),
    carrierAgencyCode: z.string().trim().max(40).optional(),
  })
  .refine(
    (query) => Boolean(query.carrierId) === Boolean(query.carrierAgencyCode),
    {
      message:
        'Send a carrier and a code together, or neither — a code alone means nothing.',
      path: ['carrierAgencyCode'],
    },
  );

export type AgencyAvailabilityQueryDto = z.infer<
  typeof agencyAvailabilitySchema
>;

/**
 * Branch name → branch slug.
 *
 * Hyphenated, matching every branch slug in the codebase (`test-branch`,
 * `other-branch`, `main`). Deliberately **not** `roles.service.ts`'s `slugify`,
 * which produces underscores for role slugs (`agency_owner`) — sharing it would
 * quietly give branches a second slug convention.
 *
 * Falls back to `main` when a name has no slug-able characters at all (say, a
 * branch named entirely in a non-Latin script), because `Branch.slug` is
 * required and a unique index on the empty string would collide on the second
 * such branch.
 */
export function toBranchSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  return slug || 'main';
}
