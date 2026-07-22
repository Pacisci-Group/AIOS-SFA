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

/** Canonical lead-source choice codes (see migration/helpers/lead-sources.ts). */
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

export const LEAD_STATUSES = [
  'New',
  'Contacted',
  'Working',
  'Quoted',
  'Won',
  'Lost',
] as const;

export const CONTACT_ROLES = [
  'Primary',
  'Spouse',
  'Child',
  'Driver',
  'Additional Named Insured',
] as const;

/** Policy-type label sets a deal/quote can cover. Feeds `deriveDealType`. */
export const POLICY_TYPE_SETS: string[][] = [
  ['Auto'],
  ['Home'],
  ['Auto', 'Home'],
  ['Renters'],
  ['Auto', 'Renters'],
  ['Condo'],
  ['Auto', 'Home', 'Umbrella'],
  ['Motorcycle'],
  ['Landlord'],
];

export interface AuditTemplateSpec {
  name: string;
  category: string;
  required: boolean;
  blocking: boolean;
  alwaysInclude: boolean;
  task: string;
}

/** The catalog of audit-item definitions used to generate hand-off items. */
export const AUDIT_TEMPLATES: AuditTemplateSpec[] = [
  {
    name: 'Signed Application',
    category: 'Documentation',
    required: true,
    blocking: true,
    alwaysInclude: true,
    task: 'Collect the client-signed application for the new policy.',
  },
  {
    name: 'EFT / Payment Authorization',
    category: 'Financial',
    required: true,
    blocking: true,
    alwaysInclude: true,
    task: 'Confirm payment method and signed EFT authorization.',
  },
  {
    name: 'Proof of Prior Insurance',
    category: 'Prior Insurance',
    required: true,
    blocking: false,
    alwaysInclude: false,
    task: 'Obtain declarations page proving continuous prior coverage.',
  },
  {
    name: 'Escrow / Mortgagee Info',
    category: 'Property',
    required: true,
    blocking: false,
    alwaysInclude: false,
    task: 'Verify mortgagee clause and escrow billing details.',
  },
  {
    name: 'Home Inspection Photos',
    category: 'Property',
    required: false,
    blocking: false,
    alwaysInclude: false,
    task: 'Upload 4-corner exterior inspection photos.',
  },
  {
    name: 'Fire Receipt',
    category: 'Property',
    required: false,
    blocking: false,
    alwaysInclude: false,
    task: 'Attach proof of fire-extinguisher / alarm for discount.',
  },
  {
    name: 'Roof Receipt',
    category: 'Property',
    required: false,
    blocking: false,
    alwaysInclude: false,
    task: 'Attach roof-replacement receipt to validate roof age.',
  },
  {
    name: 'Drivewise Enrollment',
    category: 'Auto',
    required: false,
    blocking: false,
    alwaysInclude: false,
    task: 'Confirm Drivewise telematics enrollment for the discount.',
  },
  {
    name: 'Defensive Driver Certificate',
    category: 'Auto',
    required: false,
    blocking: false,
    alwaysInclude: false,
    task: 'Collect defensive-driver course completion certificate.',
  },
];

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
