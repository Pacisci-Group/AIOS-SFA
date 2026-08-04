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
  CORE_AUDIT_TEMPLATES,
  type CoreAuditTemplateSpec,
} from '../audit-templates.seed';

export type RoleSlug =
  'agency_owner' | 'branch_manager' | 'producer' | 'crm' | 'data_team';

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
}

/**
 * The demo agency's org chart: one owner, one branch manager, five producers
 * across two branches, two CRMs, and a data-team analyst. Every account uses the
 * shared demo password so you can log in as any role to exercise permission
 * gating and data scopes.
 */
export const TEAM: TeamMemberSpec[] = [
  {
    key: 'owner',
    email: 'owner@smithfamily.local',
    firstName: 'Olivia',
    lastName: 'Smith',
    roleSlug: 'agency_owner',
    branch: 'main',
  },
  {
    key: 'manager',
    email: 'manager@smithfamily.local',
    firstName: 'Taylor',
    lastName: 'Nguyen',
    roleSlug: 'branch_manager',
    branch: 'main',
  },
  {
    key: 'producer',
    email: 'producer@smithfamily.local',
    firstName: 'Pat',
    lastName: 'Producer',
    roleSlug: 'producer',
    branch: 'main',
    monthlyGoal: 60000,
  },
  {
    key: 'producer-alex',
    email: 'alex.rivera@smithfamily.local',
    firstName: 'Alex',
    lastName: 'Rivera',
    roleSlug: 'producer',
    branch: 'main',
    monthlyGoal: 55000,
  },
  {
    key: 'producer-jordan',
    email: 'jordan.blake@smithfamily.local',
    firstName: 'Jordan',
    lastName: 'Blake',
    roleSlug: 'producer',
    branch: 'main',
    monthlyGoal: 70000,
  },
  {
    key: 'producer-sam',
    email: 'sam.torres@smithfamily.local',
    firstName: 'Sam',
    lastName: 'Torres',
    roleSlug: 'producer',
    branch: 'main',
    monthlyGoal: 48000,
  },
  {
    key: 'producer-morgan',
    email: 'morgan.lee@smithfamily.local',
    firstName: 'Morgan',
    lastName: 'Lee',
    roleSlug: 'producer',
    branch: 'north',
    monthlyGoal: 52000,
  },
  {
    key: 'crm-casey',
    email: 'casey.kim@smithfamily.local',
    firstName: 'Casey',
    lastName: 'Kim',
    roleSlug: 'crm',
    branch: 'main',
  },
  {
    key: 'crm-robin',
    email: 'robin.diaz@smithfamily.local',
    firstName: 'Robin',
    lastName: 'Diaz',
    roleSlug: 'crm',
    branch: 'north',
  },
  {
    key: 'data-dana',
    email: 'dana.park@smithfamily.local',
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

/** Canonical lead-source choice codes (see `CANONICAL_LEAD_SOURCES` in @sfa/shared). */
export const LEAD_SOURCE_CODES = [
  'WCO7l', // Mailer
  'GVCgc', // Book of Business
  'UqEUq', // Allstate Lead Marketplace
  'Eos2j', // Customer Referral
  'oayGb', // Data Lot
  'X2Wrh', // Facebook
  '30sDe', // Google
  'DmjDy', // Mail Referral
  'xjtnZ', // Quotewizard
  'ymZHL', // JYA
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

export const SERVICE_CATEGORIES = [
  'Billing',
  'Policy Change',
  'Claim',
  'Coverage Question',
  'Cancellation',
  'Endorsement',
] as const;

export const SERVICE_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;

export const SERVICE_STATUSES = [
  'Open',
  'In Progress',
  'Waiting on Client',
  'Resolved',
] as const;

/** Record-count knobs for the synthetic tenant. */
export const DEMO_CONFIG = {
  seed: 20260722,
  households: 24,
  leads: 40,
  quotes: 32,
  deals: 24,
  serviceTickets: 16,
  timeOffRequests: 6,
} as const;
