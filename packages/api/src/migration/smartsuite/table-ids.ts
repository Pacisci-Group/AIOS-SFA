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
} as const;

export type SmartSuiteTableKey = keyof typeof SMARTSUITE_TABLE_IDS;
