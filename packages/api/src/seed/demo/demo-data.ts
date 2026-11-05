/**
 * Static source pools + configuration for the synthetic demo tenant. Kept
 * separate from the generation logic so the "shape" of the demo agency is easy
 * to read and tweak without touching the seeding service.
 *
 * NOTE: none of the generated client/household names may contain the tokens
 * "test", "sample" or "demo" — the migration/API treat those as test records
 * (see migration/helpers/lead-sources.ts). Demo records are always written with
 * `isTestRecord: false` so they surface on the real dashboards.
 */

import {
  SERVICE_TICKET_PRIORITIES,
  type ServiceTicketCategory,
  type ServiceTicketStatus,
  type UserAvailability,
} from '@sfa/shared';
import {
  CORE_AUDIT_TEMPLATES,
  type CoreAuditTemplateSpec,
} from '../audit-templates.seed';

export type RoleSlug =
  'agency_owner' | 'branch_manager' | 'producer' | 'csr' | 'crm' | 'data_team';

export type BranchSlug = 'main' | 'north';

export interface TeamMemberSpec {
  /** Stable demo key -> legacySmartSuiteId `demo:user:<key>`. */
  key: string;
  email: string;
  firstName: string;
  lastName: string;
  roleSlug: RoleSlug;
  branch: BranchSlug;
  /** Monthly sold-premium goal (producers only) for the Motivation Hub. */
  monthlyGoal?: number;
  /**
   * Presence (PAC-139 §6, §6a). Omitted = `available`, the default; one
   * producer is `busy` and one `away` so the Manager view's Status column
   * shows all three dots and the Command Center's "assign to" picker has
   * someone to leave out. (The worker sets everyone `away` at the agency's
   * end-of-day hour, 8 PM by default; the seed re-stamps these on every run.)
   */
  availability?: UserAvailability;
}

/**
 * The HR facts of a team member's employee profile (PAC-162), keyed by
 * `TeamMemberSpec.key`. Everyone listed is onboarded (`active`) with a hire
 * date spread over the years so an anniversary falls in any demo month; a
 * member **not** listed stays `pending` so Complete onboarding has a
 * subject. Dates of birth go on three people, one hidden from the calendar.
 * Written with `$setOnInsert`, so a demo click is not undone by a reseed.
 */
export interface TeamProfileSpec {
  /** `YYYY-MM-DD`. */
  hireDate: string;
  dateOfBirth?: string;
  showBirthday?: boolean;
  phone?: string;
}

export const TEAM_PROFILES: Record<string, TeamProfileSpec> = {
  owner: { hireDate: '2015-03-02', phone: '(312) 555-0100' },
  manager: {
    hireDate: '2018-09-17',
    dateOfBirth: '1984-06-21',
    phone: '(312) 555-0101',
  },
  producer: {
    hireDate: '2021-01-11',
    dateOfBirth: '1992-11-30',
    phone: '(312) 555-0102',
  },
  'producer-alex': { hireDate: '2022-05-09', phone: '(312) 555-0103' },
  'producer-jordan': {
    hireDate: '2019-10-28',
    dateOfBirth: '1988-02-29',
    showBirthday: false,
    phone: '(312) 555-0104',
  },
  'producer-sam': { hireDate: '2024-02-05', phone: '(312) 555-0105' },
  // `producer-morgan` is deliberately absent: the pending onboarding.
  'crm-casey': { hireDate: '2020-07-13', phone: '(312) 555-0106' },
  'crm-robin': { hireDate: '2023-03-20', phone: '(312) 555-0107' },
  'crm-priya': { hireDate: '2017-11-06', phone: '(312) 555-0108' },
  'crm-marcus': { hireDate: '2025-01-06', phone: '(312) 555-0109' },
  'data-dana': { hireDate: '2022-08-15', phone: '(312) 555-0110' },
};

/**
 * The demo agency's org chart: one owner, one branch manager, five producers
 * across two branches, two CSRs, two CRMs, and a data-team analyst. Every account uses the
 * shared demo password so you can log in as any role to exercise permission
 * gating and data scopes.
 *
 * ## Why `@demoagency.local` and not `@smithfamily.local`
 *
 * `User.email` is **globally unique**, not unique per agency. These rows are
 * upserted by email, so any address shared with the real tenant is not a
 * duplicate — it is a *move*. When this list used `owner@smithfamily.local`
 * (the migration's `SEED_AGENCY_OWNER_EMAIL`) running the demo seed after a
 * migration reassigned the migrated agency's owner to the demo tenant and
 * overwrote its `legacySmartSuiteId`, leaving the real agency with no login at
 * all. Keeping the two domains apart is what makes the seeds independent —
 * a separate agency slug alone is not enough.
 */
export const TEAM: TeamMemberSpec[] = [
  {
    key: 'owner',
    email: 'owner@demoagency.local',
    firstName: 'Olivia',
    lastName: 'Smith',
    roleSlug: 'agency_owner',
    branch: 'main',
  },
  {
    key: 'manager',
    email: 'manager@demoagency.local',
    firstName: 'Taylor',
    lastName: 'Nguyen',
    roleSlug: 'branch_manager',
    branch: 'main',
  },
  {
    key: 'producer',
    email: 'producer@demoagency.local',
    firstName: 'Pat',
    lastName: 'Producer',
    roleSlug: 'producer',
    branch: 'main',
    monthlyGoal: 60000,
  },
  {
    key: 'producer-alex',
    email: 'alex.rivera@demoagency.local',
    firstName: 'Alex',
    lastName: 'Rivera',
    roleSlug: 'producer',
    branch: 'main',
    monthlyGoal: 55000,
  },
  {
    key: 'producer-jordan',
    email: 'jordan.blake@demoagency.local',
    firstName: 'Jordan',
    lastName: 'Blake',
    roleSlug: 'producer',
    branch: 'main',
    monthlyGoal: 70000,
    availability: 'busy',
  },
  {
    key: 'producer-sam',
    email: 'sam.torres@demoagency.local',
    firstName: 'Sam',
    lastName: 'Torres',
    roleSlug: 'producer',
    branch: 'main',
    monthlyGoal: 48000,
    availability: 'away',
  },
  {
    key: 'producer-morgan',
    email: 'morgan.lee@demoagency.local',
    firstName: 'Morgan',
    lastName: 'Lee',
    roleSlug: 'producer',
    branch: 'north',
    monthlyGoal: 52000,
  },
  {
    key: 'crm-casey',
    email: 'casey.kim@demoagency.local',
    firstName: 'Casey',
    lastName: 'Kim',
    roleSlug: 'csr',
    branch: 'main',
  },
  {
    key: 'crm-robin',
    email: 'robin.diaz@demoagency.local',
    firstName: 'Robin',
    lastName: 'Diaz',
    roleSlug: 'csr',
    branch: 'north',
  },
  {
    key: 'crm-priya',
    email: 'priya.natarajan@demoagency.local',
    firstName: 'Priya',
    lastName: 'Natarajan',
    roleSlug: 'crm',
    branch: 'main',
  },
  {
    key: 'crm-marcus',
    email: 'marcus.bell@demoagency.local',
    firstName: 'Marcus',
    lastName: 'Bell',
    roleSlug: 'crm',
    branch: 'north',
  },
  {
    key: 'data-dana',
    email: 'dana.park@demoagency.local',
    firstName: 'Dana',
    lastName: 'Park',
    roleSlug: 'data_team',
    branch: 'main',
  },
];

export const BRANCHES: {
  slug: BranchSlug;
  name: string;
  isDefault: boolean;
}[] = [
  { slug: 'main', name: 'Main', isDefault: true },
  { slug: 'north', name: 'Northgate', isDefault: false },
];

export const FIRST_NAMES = [
  'James',
  'Mary',
  'Robert',
  'Patricia',
  'John',
  'Jennifer',
  'Michael',
  'Linda',
  'David',
  'Elizabeth',
  'William',
  'Barbara',
  'Richard',
  'Susan',
  'Joseph',
  'Jessica',
  'Thomas',
  'Sarah',
  'Christopher',
  'Karen',
  'Daniel',
  'Nancy',
  'Matthew',
  'Lisa',
  'Anthony',
  'Betty',
  'Mark',
  'Sandra',
  'Donald',
  'Ashley',
  'Steven',
  'Kimberly',
  'Andrew',
  'Emily',
  'Joshua',
  'Donna',
] as const;

export const LAST_NAMES = [
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Garcia',
  'Miller',
  'Davis',
  'Rodriguez',
  'Martinez',
  'Hernandez',
  'Lopez',
  'Gonzalez',
  'Wilson',
  'Anderson',
  'Thomas',
  'Taylor',
  'Moore',
  'Jackson',
  'Martin',
  'Thompson',
  'White',
  'Harris',
  'Sanchez',
  'Clark',
  'Ramirez',
  'Lewis',
  'Robinson',
  'Walker',
  'Young',
  'Allen',
  'King',
  'Wright',
  'Scott',
  'Hill',
  'Green',
] as const;

export interface CitySpec {
  city: string;
  state: string;
  zip: string;
}

export const CITIES: CitySpec[] = [
  { city: 'Springfield', state: 'IL', zip: '62701' },
  { city: 'Naperville', state: 'IL', zip: '60540' },
  { city: 'Aurora', state: 'IL', zip: '60505' },
  { city: 'Peoria', state: 'IL', zip: '61602' },
  { city: 'Rockford', state: 'IL', zip: '61101' },
  { city: 'Evanston', state: 'IL', zip: '60201' },
  { city: 'Joliet', state: 'IL', zip: '60431' },
  { city: 'Champaign', state: 'IL', zip: '61820' },
];

export interface MailerCitySpec extends CitySpec {
  /** Zero-padded Census county FIPS, as the source column ships it. */
  countyFips: string;
}

/**
 * Mailer addresses are **Oklahoma**, unlike the Illinois {@link CITIES} the
 * rest of the demo tenant uses.
 *
 * Not cosmetic. The Mailers drawer resolves `county` through a state-keyed FIPS
 * table (`common/mailers/county-names.ts`) that today carries Oklahoma only, so
 * an Illinois row could never exercise the county row however plausible its
 * FIPS code looked. The seed also stamps `market: 'Tulsa' | 'Oklahoma City'`
 * and a 918 `agencyPhone` on these records, which had been sitting on Illinois
 * addresses since PAC-73.
 *
 * Real cities, real zips, real county codes — each `countyFips` is the county
 * the city actually sits in, and all seventeen codes in the committed RTP
 * fixture are Oklahoma too.
 */
export const MAILER_CITIES: MailerCitySpec[] = [
  { city: 'Tulsa', state: 'OK', zip: '74133', countyFips: '143' },
  { city: 'Broken Arrow', state: 'OK', zip: '74012', countyFips: '143' },
  { city: 'Owasso', state: 'OK', zip: '74055', countyFips: '143' },
  { city: 'Bixby', state: 'OK', zip: '74008', countyFips: '143' },
  { city: 'Bartlesville', state: 'OK', zip: '74006', countyFips: '147' },
  { city: 'Oklahoma City', state: 'OK', zip: '73142', countyFips: '109' },
  { city: 'Edmond', state: 'OK', zip: '73013', countyFips: '109' },
  { city: 'Claremore', state: 'OK', zip: '74017', countyFips: '131' },
  { city: 'Sapulpa', state: 'OK', zip: '74066', countyFips: '037' },
  { city: 'Guthrie', state: 'OK', zip: '73044', countyFips: '083' },
];

export const STREET_NAMES = [
  'Maple',
  'Oak',
  'Cedar',
  'Elm',
  'Pine',
  'Washington',
  'Lincoln',
  'Lake',
  'Hill',
  'Sunset',
  'Ridge',
  'Prairie',
  'Church',
  'Franklin',
  'Willow',
  'Chestnut',
] as const;

export const STREET_SUFFIXES = ['St', 'Ave', 'Rd', 'Dr', 'Ln', 'Ct'] as const;

export const CARRIERS = [
  'Allstate',
  'Progressive',
  'GEICO',
  'State Farm',
  'Liberty Mutual',
  'Travelers',
  'Nationwide',
  'Farmers',
] as const;

/**
 * Lead sources the demo agency's leads come from (PAC-135).
 *
 * Both kinds on purpose: the first six are platform rows
 * (`PLATFORM_LEAD_SOURCES`), the last three are not, so the seed creates them as
 * the demo agency's own — which is what exercises the "platform ∪ agency" read.
 * `Mailer` is repeated to keep it the largest source, as it is in real data.
 */
export const DEMO_LEAD_SOURCE_NAMES = [
  'Mailer',
  'Mailer',
  'Book of Business',
  'Customer Referral',
  'Facebook',
  'Google',
  'Web',
  'Quotewizard',
  'Data Lot',
  'Allstate Lead Marketplace',
] as const;

/**
 * Statuses the demo seed picks from — weighted toward the top of the pipeline so
 * the Leads page has plenty of New/Contacted rows. Every value must be one of
 * the canonical `LEAD_STATUSES` in @sfa/shared (PAC-36); the previous list used
 * `Working`/`Won`, which are not real SmartSuite choices and so fell outside the
 * status filter.
 */
export const DEMO_LEAD_STATUSES = [
  'New',
  'New',
  'Contacted',
  'Contacted',
  'Qualified',
  'Quoted',
  'Requote',
  'Sold',
  'Not Qualified',
  'Lost',
] as const;

/**
 * The statuses a lead can hold when it never reached a proposal.
 *
 * `Quoted`/`Requote`/`Sold` are deliberately absent: those are assigned by
 * pipeline position in `seedLeads` and backed by a real recap or deal. Drawing
 * them at random here is what previously produced leads marked `Sold` with no
 * deal attached — the whole reason the Lead Detail page looked broken on demo
 * data. Weighted to keep the top of the funnel busiest.
 */
export const DEMO_LEAD_UNQUOTED_STATUSES = [
  'New',
  'New',
  'New',
  'Contacted',
  'Contacted',
  'Contacted',
  'Qualified',
  'Qualified',
  'Not Qualified',
  'Lost',
] as const;

export const CONTACT_ROLES = [
  'Primary',
  'Spouse',
  'Child',
  'Driver',
  'Additional Named Insured',
] as const;

/**
 * Policy-type label sets a deal/quote can cover. Feeds `deriveDealType`.
 *
 * Values must be canonical `POLICY_TYPES` labels (`@sfa/shared`) — seeding a
 * non-canonical spelling puts a third vocabulary into the same field the
 * migration and the app both write.
 */
export const POLICY_TYPE_SETS: string[][] = [
  ['Auto'],
  ['Home'],
  ['Auto', 'Home'],
  ['Renters'],
  ['Auto', 'Renters'],
  ['Condominium'],
  ['Auto', 'Home', 'Umbrella'],
  ['Motorcycle'],
  ['Landlord'],
];

/**
 * Split a whole-dollar amount into `parts` whole-dollar shares that add back up
 * to it exactly — the remainder goes on the last share. `splitAmount(1001, 2)`
 * is `[500, 501]`, where a rounded equal share gives `501 + 501`.
 */
export function splitAmount(amount: number, parts: number): number[] {
  const count = Math.max(parts, 1);
  const share = Math.floor(amount / count);
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? amount - share * (count - 1) : share,
  );
}

export type AuditTemplateSpec = CoreAuditTemplateSpec;

/**
 * The catalog of audit-item definitions used to generate hand-off items.
 *
 * Re-exported from the **core** seed (PAC-40) rather than defined here. It used
 * to be its own list — "Signed Application", "EFT / Payment Authorization",
 * "Fire Receipt", … — which shared **zero** names with the production
 * vocabulary that `AuditGenerationService` resolves against. Demo data
 * therefore exercised a checklist no real agency has, and a sold deal seeded
 * locally would have generated a completely different set of items than one
 * booked against migrated data.
 *
 * Keeping one list means the demo tenant is a faithful rehearsal of production.
 */
export const AUDIT_TEMPLATES: AuditTemplateSpec[] = CORE_AUDIT_TEMPLATES;

/*
 * Drawn from the live CRM vocabulary, not a local list: the ticket schema
 * enum-enforces all three fields, so a seeded `Claim` or `Coverage Question`
 * ticket would be rejected on the first edit a CSR made to it. `Onboarding`,
 * `Quote` and the renewal categories stay out — each is a chain the seed's
 * later stages open through the service, not a bare ticket.
 */
export const SERVICE_CATEGORIES = [
  'Billing',
  'Policy Change',
  'Claims Assist',
  'Payment',
  'Endorsement',
  'Other',
] as const satisfies readonly ServiceTicketCategory[];

export const SERVICE_PRIORITIES = SERVICE_TICKET_PRIORITIES;

export const SERVICE_STATUSES = [
  'open',
  'in_progress',
  'waiting_on_client',
  'resolved',
] as const satisfies readonly ServiceTicketStatus[];

/** Record-count knobs for the synthetic tenant. */
export const DEMO_CONFIG = {
  seed: 20260722,
  households: 24,
  leads: 90,
  quotes: 32,
  deals: 24,
  /**
   * How many sold leads get a **second, older** recap.
   *
   * Without this the funnel divides exactly one recap per quoted-or-sold lead
   * and the Lead Detail "N earlier recaps" expander can never be exercised —
   * so `quotes` is deliberately more than the number of leads that carry one.
   */
  repeatQuoteLeads: 4,
  serviceTickets: 16,
  mailers: 14,
  /**
   * Manager view fixtures (PAC-139), forced onto records the generators above
   * would otherwise draw at random — so the three alert cards never all read
   * zero on a fresh seed. Each override replaces a drawn value *after* the
   * draw, so the seeded RNG sequence, and every record after it, is unchanged.
   */
  stalledLeads: 6,
  agingAudits: 3,
  overdueTickets: 3,
} as const;

/**
 * Time off requests for the demo tenant (PAC-165): one in every state the
 * Time off page can show, so neither the employee's list nor the reviewer's
 * queue opens empty.
 *
 * Dates are **relative to the week the seed runs in**: `week` counts weeks
 * from the current one (negative = past), `from` is the weekday offset from
 * that Monday, `days` the calendar length. The hours are computed from each
 * person's work week and holiday policy when the seed runs, exactly as a
 * request made in the app — so a week holding Thanksgiving shows the
 * holiday rows at zero hours.
 *
 * Pat Producer (the demo login) carries most of them: a producer signing in
 * sees every group. The others fill the Branch Manager's To review list and
 * the "who else is off" panel; Morgan is in the Northgate branch, so only
 * the owner's agency scope reaches that one. **Sam Torres has none**, on
 * purpose — the Bruno `Time Off` folder records time off for Sam and must
 * not trip the overlap block.
 */
export type DemoTimeOffStory =
  | 'draft'
  | 'pending'
  | 'changes_requested'
  | 'auto_approved'
  | 'approved'
  | 'recorded'
  | 'declined'
  | 'cancelled_after_approval';

export interface DemoTimeOffRequestSpec {
  /** Stable seed key: `demo:tor:<key>`. */
  key: string;
  /** `TeamMemberSpec.key` of the employee. */
  employee: string;
  story: DemoTimeOffStory;
  week: number;
  from: 0 | 1 | 2 | 3 | 4;
  days: number;
  /** The employee's note (or the recorder's, on a recorded entry). */
  note?: string;
  /** The reviewer's note on a decision. */
  reviewerNote?: string;
}

export const DEMO_TIME_OFF_REQUESTS: DemoTimeOffRequestSpec[] = [
  {
    key: 'pat-draft',
    employee: 'producer',
    story: 'draft',
    week: 6,
    from: 0,
    days: 3,
  },
  {
    key: 'pat-changes',
    employee: 'producer',
    story: 'changes_requested',
    week: 4,
    from: 3,
    days: 2,
    note: 'Long weekend away.',
    reviewerNote:
      'Jordan is out that Thursday. Could you take the Friday only?',
  },
  {
    key: 'pat-auto',
    employee: 'producer',
    story: 'auto_approved',
    week: 2,
    from: 0,
    days: 2,
  },
  {
    key: 'pat-recorded',
    employee: 'producer',
    story: 'recorded',
    week: -3,
    from: 2,
    days: 1,
    note: 'Called in sick.',
  },
  {
    key: 'pat-declined',
    employee: 'producer',
    story: 'declined',
    week: 3,
    from: 0,
    days: 5,
    note: 'Family visiting.',
    reviewerNote:
      'Alex already asked for that week. Pick another and I will approve it.',
  },
  {
    key: 'pat-cancelled',
    employee: 'producer',
    story: 'cancelled_after_approval',
    week: 5,
    from: 0,
    days: 1,
  },
  {
    key: 'alex-pending',
    employee: 'producer-alex',
    story: 'pending',
    week: 3,
    from: 0,
    days: 5,
    note: 'Visiting family out of state.',
  },
  {
    key: 'jordan-pending',
    employee: 'producer-jordan',
    story: 'pending',
    week: 2,
    from: 1,
    days: 4,
  },
  {
    key: 'casey-approved',
    employee: 'crm-casey',
    story: 'approved',
    week: 3,
    from: 1,
    days: 2,
    reviewerNote: 'Enjoy.',
  },
  {
    key: 'morgan-pending',
    employee: 'producer-morgan',
    story: 'pending',
    week: 4,
    from: 0,
    days: 1,
    note: 'Moving day.',
  },
];
