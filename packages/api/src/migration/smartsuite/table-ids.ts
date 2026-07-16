/**
 * SmartSuite table (application) IDs for the Producer Dashboard migration.
 * Defaults come from `docs/SFA SmartSuite Tables` and the legacy SFA app; each is
 * overridable via env so a different workspace/solution can be pointed at.
 */
export const SMARTSUITE_TABLE_IDS = {
  users: process.env.SMARTSUITE_USERS_TABLE_ID ?? '69422c487eafe925c8e4bbfa',
  households:
    process.env.SMARTSUITE_HOUSEHOLDS_TABLE_ID ?? '6941fa11964c58f31380427c',
  leads: process.env.SMARTSUITE_LEADS_TABLE_ID ?? '6941fdb1dc9a6d024fd8b505',
  quoteRecaps:
    process.env.SMARTSUITE_QUOTE_RECAPS_TABLE_ID ?? '6941fdb2dc9a6d024fd8bc53',
  deals:
    process.env.SMARTSUITE_DEALS_TABLE_ID ??
    process.env.SMARTSUITE_SOLD_LOG_TABLE_ID ??
    '6941fdb2dc9a6d024fd8c3a1',
  dealAuditItems:
    process.env.SMARTSUITE_DEAL_AUDIT_ITEMS_TABLE_ID ??
    '69533b022b0995e027431c02',
  contacts:
    process.env.SMARTSUITE_CONTACTS_TABLE_ID ?? '6941fb21eea41b87f26cd10d',
  policies:
    process.env.SMARTSUITE_POLICIES_TABLE_ID ?? '6941fc5b08644a5fbf05a781',
  serviceTickets:
    process.env.SMARTSUITE_SERVICE_TICKETS_TABLE_ID ??
    '6941fdb3dc9a6d024fd8d23d',
  dealAudits:
    process.env.SMARTSUITE_DEAL_AUDITS_TABLE_ID ?? '6941fdb2dc9a6d024fd8caef',
  interestedParties:
    process.env.SMARTSUITE_INTERESTED_PARTIES_TABLE_ID ??
    '694240c03d897b7099d73340',
  priorInsurance:
    process.env.SMARTSUITE_PRIOR_INSURANCE_TABLE_ID ??
    '69423c25d4f749d1e15c017a',
  priorPolicies:
    process.env.SMARTSUITE_PRIOR_POLICIES_TABLE_ID ??
    '69423e89ea5c9f2798e4bc00',
  producerAssignments:
    process.env.SMARTSUITE_PRODUCER_ASSIGNMENTS_TABLE_ID ??
    '695ec3890ac528daf6607fa2',
  crmRotations:
    process.env.SMARTSUITE_CRM_ROTATION_TABLE_ID ?? '695ec474897e7b72911f64d7',
  timeOffRequests:
    process.env.SMARTSUITE_TIME_OFF_REQUEST_TABLE_ID ??
    '696dd246b1bf4b889f2fb4fa',
  auditTemplates:
    process.env.SMARTSUITE_AUDIT_TEMPLATES_TABLE_ID ??
    '69532d09f018acf38e53443a',
} as const;

export type SmartSuiteTableKey = keyof typeof SMARTSUITE_TABLE_IDS;
