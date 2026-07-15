/**
 * SmartSuite field IDs (stable slugs) per source table, extracted from
 * `docs/SFA SmartSuite Tables` and cross-checked against the legacy SFA reads.
 * Field IDs are the stable API keys (field *names* can be renamed in SmartSuite).
 */

export const USER_FIELDS = {
  /** RECORD_ID() formula — the stable linked-record id used everywhere else. */
  recordId: 's1307bd77f',
  firstName: 's301929112',
  lastName: 's67dadd3ec',
  fullName: 'sc07f0ceb3',
  email: 's98a9dc07e',
  phone: 's96dd1525b',
  role: 'sd68wn2p',
  department: 's60e850437',
  employeeStatus: 's0315d110f',
  isActive: 'sdf74e188c',
  clerkUserId: 'sf993dbf77',
  monthlyGoal: 's72ea8dfab',
} as const;

export const HOUSEHOLD_FIELDS = {
  status: 's5f13c562d',
  householdName: 'sb63528cc7',
  normalizedPrimaryName: 'sbdc50a856',
  propertyAddress: 's3c3e21ee2',
  mailingAddress: 's43e6ec449',
  primaryEmail: 'se05e29831',
  primaryPhone: 'sugaqz8o',
  assignedCrm: 'se5d1492f3',
  totalActivePolicies: 's734c4c9d4',
} as const;

export const LEAD_FIELDS = {
  createdDate: 'created_date',
  lastUpdated: 'last_updated',
  leadSource: 'lead_source',
  temperature: 'temperature',
  status: 'status',
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  phone: 'phone',
  quoteControlNumber: 's120960602',
  producer: 's2431092ba',
  household: 's4f5f73a22',
} as const;

export const QUOTE_RECAP_FIELDS = {
  quoteDate: 's376d7a544',
  premium: 's98af0638c',
  items: 'sd19cab342',
  productsQuoted: 's1e17612aa',
  recapStatus: 'recap_status',
  producer: 'sf9e2dcdfb',
  lead: 'sbcb3c8b31',
  household: 'se84b0aa3d',
} as const;

export const DEAL_FIELDS = {
  title: 'title',
  autonumber: 'autonumber',
  soldDate: 'sold_date',
  soldDateYmd: 's6476659a2',
  premiumRollup: 's0675d21ce',
  premiumSnapshot: 'total_premium_snapshot',
  totalItems: 'sc76a6a409',
  policyCount: 's8e1f0c85d',
  policyTypes: 's37fb9a5b2',
  bundle: 'sir4pvkc',
  leadSource: 's989aa45e7',
  clientName: 'sb0fd70600',
  status: 's30e41153c',
  dealAuditStatus: 'deal_audit_status',
  producer: 's5c3f8f062',
  producerRecId: 's274954640',
  lead: 's29ac27a8a',
  household: 's640bdcd7d',
  quoteRecap: 's74c0950b7',
} as const;

export const DEAL_AUDIT_ITEM_FIELDS = {
  title: 'title',
  deal: 's05ab1053c',
  category: 'sa38a2d635',
  itemName: 's9fa744e78',
  status: 'sdb5069dbd',
  updateStatus: 's5cd2f1d5a',
  required: 's68ec160c0',
  blocking: 'sowlcvdy',
  applicable: 's14phmo9',
  normalizedClientName: 'sd1a6233f4',
  normalizedProducerName: 's10lakqv',
  daysOpen: 's939cb7bec',
  firstCreated: 'first_created',
} as const;

/**
 * Select-choice value -> label maps for fields whose choices we normalize.
 * Only the codes we care about for the dashboard are listed.
 */
export const DEAL_AUDIT_STATUS_LABELS: Record<string, string> = {
  backlog: 'Not Started',
  in_progress: 'Failed',
  complete: 'Complete',
};

export const DEAL_AUDIT_UPDATE_STATUS_LABELS: Record<string, string> = {
  backlog: 'Missing',
  in_progress: 'Submitted - Ready for Review',
  complete: 'Verified - Complete',
};

export const DEAL_AUDIT_ITEM_NAME_LABELS: Record<string, string> = {
  iSSXH: 'Defensive Driver',
  m0k6n: 'Fire Subscription',
  puXG7: 'Actual Cash Value',
  v4qnW: '(Mortgagee) Escrow Payment',
  '7yDnF': 'Good Student',
  Qmqzr: 'Drivewise',
  DcAq8: 'Hail Resistant Roof',
  zmyVX: 'Home Inspection',
  guhUP: 'Correct Sold Date',
  LYJfx: 'Correct Effective Date',
  jKjFr: 'Prior Insurance',
  m7FKN: 'Accord Cancellation',
  pWrw5: 'Quote Recap',
  QcOSN: 'Lead Manager',
  Lbo2i: 'Drivers Verified',
  '0Y3Xs': 'Evidence of Insurance',
};

export const DEAL_AUDIT_CATEGORY_LABELS: Record<string, string> = {
  VeW4i: 'Auto',
  m1LoO: 'Home',
  ehjDd: 'Landlord',
  hQrq6: 'Common',
};

/** Deal "Policy Type(s)" lookup codes -> line-of-business labels. */
export const POLICY_TYPE_LABELS: Record<string, string> = {
  AiFB5: 'Landlord',
  PYgez: 'Auto',
  sNMRK: 'Home',
  Hn155: 'Renters',
  OMJjl: 'Motorcycle',
  mCt4m: 'Landlords',
  uBjtw: 'Valuable Item Protection',
  NlLBc: 'Boat Owners',
  fltex: 'Umbrella',
  EGGWR: 'Life',
  mrzQD: 'Condominium',
};
