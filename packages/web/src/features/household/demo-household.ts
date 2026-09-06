import type { HouseholdView } from "@sfa/shared";

/**
 * The Cobb household — the fixture behind `/clients/demo`.
 *
 * This is the *only* place mock client data lives. The detail components take
 * a required `household` prop, so the demo route and a live record render
 * through the exact same code path: there is no fallback branch a real record
 * can slip into, and a missing field renders as an em dash rather than as
 * someone else's phone number.
 *
 * Anything added here must be a real `HouseholdView` field. Presentation-only
 * embellishments (retention scores, tags, cross-sell estimates) have no
 * backing data and are gated on `isDemo` at the component instead.
 */

/** `HouseholdProfile` renders this as `HH-002614`. */
const DEMO_ID = "demo00000000000000002614";

const CONTACTS: HouseholdView["contacts"] = [
  {
    id: `${DEMO_ID}-c1`,
    firstName: "Jessica",
    lastName: "Cobb",
    emails: ["jessica.cobb@email.com"],
    phones: ["(404) 555-0182"],
    roleInHousehold: "Primary Insured",
    isPrimary: true,
    dateOfBirth: "1984-03-22T00:00:00.000Z",
  },
  {
    id: `${DEMO_ID}-c2`,
    firstName: "Tyler",
    lastName: "Cobb",
    emails: ["tyler.cobb@email.com"],
    phones: ["(404) 555-0199"],
    roleInHousehold: "Spouse",
    isPrimary: false,
    dateOfBirth: "1982-11-04T00:00:00.000Z",
  },
  {
    // `toMembers` flags this one as a driver by matching /driver/i on the role.
    id: `${DEMO_ID}-c3`,
    firstName: "Driver",
    lastName: "Token",
    emails: [],
    phones: [],
    roleInHousehold: "Teen Driver · Excluded",
    isPrimary: false,
    dateOfBirth: "2008-07-19T00:00:00.000Z",
  },
];

/**
 * Premiums are annual — `PolicySummary.premium` is an annual figure, and the
 * cards label it `/yr`. The original mock quoted monthly amounts; these are
 * those figures × 12 so the demo still reads like the same household.
 */
const POLICIES: HouseholdView["policies"] = [
  {
    id: `${DEMO_ID}-p1`,
    policyNumber: "AUT-847-663-21",
    policyType: "Auto",
    carrier: "Allstate",
    active: true,
    policyStatus: "Active",
    premium: 2208,
    items: 2,
    effectiveDate: "2024-03-15T00:00:00.000Z",
    expirationDate: "2025-03-15T00:00:00.000Z",
    renewalDate: "2025-03-15T00:00:00.000Z",
  },
  {
    id: `${DEMO_ID}-p2`,
    policyNumber: "HOM-291-447-08",
    policyType: "Home",
    carrier: "Allstate",
    active: true,
    policyStatus: "Active",
    premium: 3744,
    items: 1,
    effectiveDate: "2024-06-01T00:00:00.000Z",
    expirationDate: "2025-06-01T00:00:00.000Z",
    renewalDate: "2025-06-01T00:00:00.000Z",
  },
  {
    id: `${DEMO_ID}-p3`,
    policyNumber: "UMB-033-119-55",
    policyType: "Umbrella",
    carrier: "Allstate",
    active: true,
    policyStatus: "Active",
    premium: 336,
    items: 1,
    effectiveDate: "2024-06-01T00:00:00.000Z",
    expirationDate: "2025-06-01T00:00:00.000Z",
    renewalDate: "2025-06-01T00:00:00.000Z",
  },
  {
    id: `${DEMO_ID}-p4`,
    policyNumber: "LND-558-882-34",
    policyType: "Landlord",
    carrier: "Allstate",
    active: true,
    policyStatus: "Active",
    premium: 1152,
    items: 1,
    effectiveDate: "2024-01-10T00:00:00.000Z",
    expirationDate: "2025-01-10T00:00:00.000Z",
    renewalDate: "2025-01-10T00:00:00.000Z",
  },
];

export const DEMO_HOUSEHOLD: HouseholdView = {
  id: DEMO_ID,
  name: "The Cobb Household",
  status: "Active",
  primaryContactName: "Jessica Cobb",
  totalActivePolicies: POLICIES.filter((p) => p.active).length,
  // The normalized shape the API resolves for a live record; `propertyAddress`
  // below keeps the demo seed's raw key set so the fixture still stands in for
  // one of the three stored shapes.
  address: {
    street: "412 Magnolia Lane",
    city: "Alpharetta",
    state: "GA",
    zip: "30022",
  },
  propertyAddress: {
    line1: "412 Magnolia Lane",
    city: "Alpharetta",
    state: "GA",
    postalCode: "30022",
  },
  mailingAddress: null,
  primaryEmails: ["jessica.cobb@email.com"],
  primaryPhones: ["(404) 555-0182"],
  assignedCrmId: null,
  contacts: CONTACTS,
  policies: POLICIES,
};
