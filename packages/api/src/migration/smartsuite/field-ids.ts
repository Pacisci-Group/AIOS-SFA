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
  /**
   * The record title — SmartSuite's auto-generated `#HH2614`, which legacy
   * surfaced as `householdTitle`. Imported into `Household.householdRef` so the
   * agency keeps the numbers it already uses.
   */
  householdRef: 'title',
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
  /** "Insurance X Month" — a single-select of the 12 months (PAC-56 #16). */
  insuranceMonth: 's69d7c3f64',
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

export const CONTACT_FIELDS = {
  firstName: 'sa5a6956b1',
  lastName: 's463f12943',
  email: 's311269c0c',
  phone: 's03c983a27',
  dateOfBirth: 's1fb9a8813',
  roleInHousehold: 'se79ae4f7f',
  isPrimary: 's413f031d4',
  notes: 's39661d2f6',
  household: 's66cf9402f',
} as const;

export const POLICY_FIELDS = {
  policyNumber: 'title',
  household: 's5cb27d5d9',
  policyType: 'sc0d2e4b72',
  carrier: 's33be9b77d',
  active: 'sd4ff7d9f7',
  effectiveDate: 's17370a3f9',
  expirationDate: 'sb0fdb18f6',
  renewalDate: 'sa2c7585b5',
  premium: 's59b4726cc',
  items: 's7839a0aac',
  notes: 'se356ed81c',
  policyStatus: 's87f83281a',
  deal: 's63e96e0b6',
} as const;

export const SERVICE_TICKET_FIELDS = {
  title: 'title',
  createdDate: 'created_date',
  category: 'category',
  priority: 'priority',
  dueDate: 'due_date',
  policy: 's12d537d98',
  household: 's85ccd75be',
  assignedCrm: 's4ec085028',
  status: 's7afd05edc',
  dateResolved: 's879083121',
  daysOpen: 's8a59a03dd',
  createdBy: 's53333e8c3',
  clientName: 'setuud00',
  crmName: 's43ee2ba8f',
  firstCreated: 'first_created',
  /*
   * The four below were not imported by the first migration, which wrote a
   * thin mirror of the table. They are what turns a row into a ticket a CSR
   * can act on: the body text becomes the opening timeline entry, the system
   * `last_updated` becomes `lastActivityAt`, and `Normalized Created By` is the
   * creator's name (`crmName` above is the *assigned* CRM, a different person
   * on 2 of 286 rows).
   */
  lastUpdated: 'last_updated',
  /** SmartDoc richtext — `{ data, html, preview }`; see `toRichText`. */
  notes: 'notes',
  /** "Ticket Notes", a plain multi-line string alongside the richtext one. */
  ticketNotes: 'sed733068f',
  createdByName: 's6e4995d56',
} as const;

export const DEAL_AUDIT_FIELDS = {
  title: 'title',
  auditId: 'audit_id',
  auditDate: 'audit_date',
  result: 'result',
  reasonCodes: 'reason_codes',
  auditScore: 'sadb5c0227',
  auditNotes: 'sbe10476c6',
  deals: 's1841790f6',
} as const;

export const INTERESTED_PARTY_FIELDS = {
  title: 'title',
  status: 'status',
  priority: 'priority',
  notes: 'scdc78adaa',
  policy: 'se907854ce',
  mortgagee: 's2fb0c5024',
  address: 's6a36e6f8f',
  loanNumber: 's19be4460e',
  household: 's005931699',
} as const;

export const PRIOR_INSURANCE_FIELDS = {
  title: 'title',
  deal: 'sc59cc32b8',
  household: 'sb04421c43',
  cancellationResponsibility: 'sb3cc60eb5',
  cancelledPreviousInsurance: 's9fecf50b8',
  cancellationDate: 'sb5bc8466d',
  autoHomeSameCarrier: 'sd12264dbf',
  previousCarrierAuto: 'sbd76ff6b4',
  previousCarrierHome: 's005xf2q',
  previousAgentName: 's7f775dc83',
  producer: 's3dc982787',
} as const;

export const PRIOR_POLICY_FIELDS = {
  title: 'title',
  status: 'status',
  deal: 'sc59cc32b8',
  priorInsurance: 'sb04421c43',
  policyType: 'sb3cc60eb5',
  needsCancellation: 's9fecf50b8',
  cancellationDate: 'sb5bc8466d',
  accordFormNeeded: 'sd12264dbf',
  previousCarrier: 'sbd76ff6b4',
  notes: 'se683bb2aa',
  completedDate: 's596e17941',
  household: 's07708c46c',
} as const;

export const PRODUCER_ASSIGNMENT_FIELDS = {
  title: 'title',
  producer: 'sa4b1fdd09',
  lastAssignedCrm: 's5501fe08f',
  indexPointer: 's2bd7dda40',
  activeForProducer: 's12e33f568',
  lastAssignedAt: 's787019847',
  lock: 'sb5b78f0b7',
} as const;

export const CRM_ROTATION_FIELDS = {
  title: 'title',
  crm: 's5501fe08f',
  order: 's2bd7dda40',
  activeForProducer: 's12e33f568',
  producer: 's1d18f0067',
} as const;

export const TIME_OFF_REQUEST_FIELDS = {
  title: 'title',
  producer: 's11756232f',
  startDate: 's797e8e425',
  endDate: 'sfc03f2e87',
  requestType: 's4de941e84',
  hoursRequested: 's69a804f9d',
  status: 's15cf96e61',
  type: 'sec9109888',
  decision: 's9f9622cf9',
} as const;

export const AUDIT_TEMPLATE_FIELDS = {
  name: 'title',
  category: 'sa38a2d635',
  required: 's68ec160c0',
  blocking: 'sowlcvdy',
  active: 'sgdipwqk',
  alwaysInclude: 'sa8f5c7a37',
  task: 's53430cc34',
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

/*
 * Deal "Policy Type(s)" lookup codes lived here as `POLICY_TYPE_LABELS` until
 * PAC-40. They now live in `@sfa/shared` (`domain/policy-type.ts`), which
 * reconciles all three SmartSuite code sets — Quote Recaps, Deals and Policies
 * — into one canonical vocabulary via `normalizePolicyType`.
 *
 * Removed rather than deprecated on purpose: this map emitted "Landlords" for
 * `mCt4m` while shared says "Landlord", and two divergent copies of a
 * vocabulary the audit generator matches on **by exact name** is precisely the
 * bug that motivated the unification.
 */
