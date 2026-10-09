import { Model, Types } from 'mongoose';
import { displayName } from '../../domain/user-names';
import { contactDisplayName } from '../../domain/contact-names';

/**
 * The models the lookups read. Typed loosely on purpose: every query below
 * projects and `.lean<T>()`s to an explicit row shape, which is the type that
 * matters, and a dozen `Model<XDocument>` generics would add nothing but noise.
 */

type AnyModel = Model<any>;

export interface ExportModels {
  lead: AnyModel;
  deal: AnyModel;
  quoteRecap: AnyModel;
  policy: AnyModel;
  household: AnyModel;
  householdMember: AnyModel;
  contact: AnyModel;
  dealAudit: AnyModel;
  interestedParty: AnyModel;
  chargeback: AnyModel;
  user: AnyModel;
  branch: AnyModel;
  /**
   * Read directly rather than through `LeadSourcesService.labelsFor`: the
   * worker builds these lookups, and its import boundary admits schemas but
   * no feature service. The query is that method's, verbatim.
   */
  leadSource: AnyModel;
}

/** Anything that stringifies to an id: an ObjectId, a lean `_id`, a string. */
export type IdLike = Types.ObjectId | string | null | undefined;

export interface AddressLike {
  street?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface ContactRow {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
  deceasedAt: Date | null;
}

export interface HouseholdRow {
  householdRef: string | null;
  name: string | null;
  primaryContactId: Types.ObjectId | null;
  assignedCrmId: Types.ObjectId | null;
  propertyAddress: AddressLike | null;
}

export interface LeadRow {
  status: string | null;
  leadSourceId: Types.ObjectId | null;
}

export interface DealRow {
  dealAutoNumber: number | null;
  soldDateYmd: number | null;
  producerId: Types.ObjectId | null;
  dealType: string | null;
}

export interface PolicyLite {
  _id: Types.ObjectId;
  policyNumber?: string;
  policyType?: string;
  carrier?: string;
  policyStatus?: string;
  active?: boolean;
  premium?: number;
}

export interface AuditLite {
  _id: Types.ObjectId;
  dealId: Types.ObjectId;
  auditStatus?: string;
  itemCount?: number;
  resolvedCount?: number;
  openFailedCount?: number;
  dueAt?: Date;
  submittedAt?: Date;
}

export interface QuoteLite {
  _id: Types.ObjectId;
  leadId: Types.ObjectId;
  quoteDateYmd?: number;
  premium?: number;
}

export interface DealLite {
  _id: Types.ObjectId;
  leadId?: Types.ObjectId;
  quoteRecapId?: Types.ObjectId;
  soldDateYmd?: number;
  premium?: number;
  chargebackAdjustment?: number;
}

export interface MembershipLite {
  householdId: Types.ObjectId;
  contactId: Types.ObjectId;
  role?: string;
}

export interface InterestedPartyLite {
  policyId: Types.ObjectId;
  mortgagee?: string;
  loanNumber?: string;
}

function key(id: IdLike): string | null {
  return id ? String(id) : null;
}

function uniqueIds(ids: Iterable<IdLike>): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const value = key(id);
    if (value && Types.ObjectId.isValid(value)) out.add(value);
  }
  return [...out];
}

function oids(ids: readonly string[]): Types.ObjectId[] {
  return ids.map((id) => new Types.ObjectId(id));
}

function groupBy<T>(
  rows: readonly T[],
  by: (row: T) => IdLike,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(by(row));
    if (!k) continue;
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

/**
 * Id → row, fetched once per id for the whole export. A row id the store does
 * not return (a dangling ref) is remembered as missing, so it is not asked for
 * again on the next batch.
 */
class Memo<T> {
  private readonly rows = new Map<string, T | null>();

  constructor(
    private readonly fetch: (ids: string[]) => Promise<Map<string, T>>,
  ) {}

  async load(ids: Iterable<IdLike>): Promise<void> {
    const missing = uniqueIds(ids).filter((id) => !this.rows.has(id));
    if (!missing.length) return;
    const found = await this.fetch(missing);
    for (const id of missing) this.rows.set(id, found.get(id) ?? null);
  }

  get(id: IdLike): T | null {
    const k = key(id);
    return k ? (this.rows.get(k) ?? null) : null;
  }
}

/**
 * The label and child loaders one export run reads through (PAC-152).
 *
 * Built per export, never shared: the memo is the cache, and its lifetime is
 * exactly one download. Two kinds of loader:
 *
 * - **Labels** (`users`, `contacts`, `households`, `leads`, `deals`, plus the
 *   once-per-export `leadSources` and `branches`) — memoised across batches,
 *   because the same producer or household recurs on every page of rows.
 * - **Children** (`policiesByDeal`, `membersByHousehold`, …) — one query per
 *   batch keyed by the batch's parent ids, grouped in memory. Not memoised: a
 *   parent appears in exactly one batch.
 *
 * Every query pins `agencyId` and drops `isTestRecord` rows. A label lookup is
 * not a second scope check — the parent row already passed one — but a child
 * from another agency must be unreachable however a reference was written.
 *
 * The idiom is `LeadSourcesService.labelsFor` / `displayNamesFor` /
 * `loadContactDetails`: batched `$in` reads resolved in memory, never a
 * `$lookup` per row.
 */
export class ExportLookups {
  readonly users: Memo<string>;
  readonly contacts: Memo<ContactRow>;
  readonly households: Memo<HouseholdRow>;
  readonly leads: Memo<LeadRow>;
  readonly deals: Memo<DealRow>;

  private leadSourceLabels: Map<string, string> | null = null;
  private branchNames: Map<string, string> | null = null;

  constructor(
    private readonly models: ExportModels,
    private readonly agencyId: string,
  ) {
    const tenant = { agencyId, isTestRecord: { $ne: true } };

    // Users are agency-wide by ObjectId and deliberately unfiltered by status:
    // someone who sold in March and left in June still sold in March.
    this.users = new Memo(async (ids) => {
      const rows = await models.user
        .find(
          { _id: { $in: oids(ids) } },
          { firstName: 1, lastName: 1, email: 1 },
        )
        .lean<
          {
            _id: Types.ObjectId;
            firstName?: string;
            lastName?: string;
            email: string;
          }[]
        >();
      return new Map(rows.map((row) => [String(row._id), displayName(row)]));
    });

    this.contacts = new Memo(async (ids) => {
      const rows = await models.contact
        .find(
          { ...tenant, _id: { $in: oids(ids) } },
          {
            firstName: 1,
            lastName: 1,
            email: 1,
            phone: 1,
            dateOfBirth: 1,
            deceasedAt: 1,
          },
        )
        .lean<
          {
            _id: Types.ObjectId;
            firstName?: string;
            lastName?: string;
            email?: string;
            phone?: string;
            dateOfBirth?: Date;
            deceasedAt?: Date;
          }[]
        >();
      return new Map(
        rows.map((row) => [
          String(row._id),
          {
            name: contactDisplayName(row),
            firstName: row.firstName?.trim() || null,
            lastName: row.lastName?.trim() || null,
            email: row.email?.trim() || null,
            phone: row.phone?.trim() || null,
            dateOfBirth: row.dateOfBirth ?? null,
            deceasedAt: row.deceasedAt ?? null,
          },
        ]),
      );
    });

    this.households = new Memo(async (ids) => {
      const rows = await models.household
        .find(
          { ...tenant, _id: { $in: oids(ids) } },
          {
            householdRef: 1,
            name: 1,
            primaryContactId: 1,
            assignedCrmId: 1,
            propertyAddress: 1,
          },
        )
        .lean<
          {
            _id: Types.ObjectId;
            householdRef?: string;
            name?: string;
            primaryContactId?: Types.ObjectId;
            assignedCrmId?: Types.ObjectId;
            propertyAddress?: AddressLike;
          }[]
        >();
      return new Map(
        rows.map((row) => [
          String(row._id),
          {
            householdRef: row.householdRef ?? null,
            name: row.name ?? null,
            primaryContactId: row.primaryContactId ?? null,
            assignedCrmId: row.assignedCrmId ?? null,
            propertyAddress: row.propertyAddress ?? null,
          },
        ]),
      );
    });

    this.leads = new Memo(async (ids) => {
      const rows = await models.lead
        .find(
          { ...tenant, _id: { $in: oids(ids) } },
          { status: 1, leadSourceId: 1 },
        )
        .lean<
          {
            _id: Types.ObjectId;
            status?: string;
            leadSourceId?: Types.ObjectId;
          }[]
        >();
      return new Map(
        rows.map((row) => [
          String(row._id),
          {
            status: row.status ?? null,
            leadSourceId: row.leadSourceId ?? null,
          },
        ]),
      );
    });

    this.deals = new Memo(async (ids) => {
      const rows = await models.deal
        .find(
          { ...tenant, _id: { $in: oids(ids) } },
          { dealAutoNumber: 1, soldDateYmd: 1, producerId: 1, dealType: 1 },
        )
        .lean<
          {
            _id: Types.ObjectId;
            dealAutoNumber?: number;
            soldDateYmd?: number;
            producerId?: Types.ObjectId;
            dealType?: string;
          }[]
        >();
      return new Map(
        rows.map((row) => [
          String(row._id),
          {
            dealAutoNumber: row.dealAutoNumber ?? null,
            soldDateYmd: row.soldDateYmd ?? null,
            producerId: row.producerId ?? null,
            dealType: row.dealType ?? null,
          },
        ]),
      );
    });
  }

  private get tenant() {
    return { agencyId: this.agencyId, isTestRecord: { $ne: true } };
  }

  /** Platform rows and inactive rows included — a historic label is still its label. */
  async leadSources(): Promise<Map<string, string>> {
    if (!this.leadSourceLabels) {
      // Platform rows (`agencyId: null`) and this agency's own — the scope
      // `LeadSourcesService.labelsFor` reads.
      const rows = await this.models.leadSource
        .find({ agencyId: { $in: [null, this.agencyId] } }, { name: 1 })
        .lean<{ _id: Types.ObjectId; name: string }[]>();
      this.leadSourceLabels = new Map(
        rows.map((row) => [String(row._id), row.name]),
      );
    }
    return this.leadSourceLabels;
  }

  leadSource(id: IdLike): string | null {
    const k = key(id);
    return k ? (this.leadSourceLabels?.get(k) ?? null) : null;
  }

  /** ⚠ `branches` carries an **ObjectId** `agencyId`, unlike every TenantRecord. */
  async branches(): Promise<Map<string, string>> {
    if (!this.branchNames) {
      const rows = await this.models.branch
        .find({ agencyId: new Types.ObjectId(this.agencyId) }, { name: 1 })
        .lean<{ _id: Types.ObjectId; name: string }[]>();
      this.branchNames = new Map(
        rows.map((row) => [String(row._id), row.name]),
      );
    }
    return this.branchNames;
  }

  branch(id: IdLike): string | null {
    const k = key(id);
    return k ? (this.branchNames?.get(k) ?? null) : null;
  }

  // ---------------------------------------------------------------------------
  // Children — one query per batch, grouped by parent id
  // ---------------------------------------------------------------------------

  async policiesBy(
    field: 'dealId' | 'householdId',
    parentIds: Iterable<IdLike>,
  ): Promise<Map<string, PolicyLite[]>> {
    const ids = uniqueIds(parentIds);
    if (!ids.length) return new Map();
    const rows = await this.models.policy
      .find(
        { ...this.tenant, [field]: { $in: oids(ids) } },
        {
          [field]: 1,
          policyNumber: 1,
          policyType: 1,
          carrier: 1,
          policyStatus: 1,
          active: 1,
          premium: 1,
        },
      )
      .sort({ _id: 1 })
      .lean<(PolicyLite & Record<string, Types.ObjectId>)[]>();
    return groupBy(rows, (row) => row[field]);
  }

  /**
   * The newest audit per deal. A deal has one audit; "newest" only decides
   * the case where a regeneration left two behind.
   */
  async auditByDeal(
    dealIds: Iterable<IdLike>,
  ): Promise<Map<string, AuditLite>> {
    const ids = uniqueIds(dealIds);
    if (!ids.length) return new Map();
    const rows = await this.models.dealAudit
      .find(
        { ...this.tenant, dealId: { $in: oids(ids) } },
        {
          dealId: 1,
          auditStatus: 1,
          itemCount: 1,
          resolvedCount: 1,
          openFailedCount: 1,
          dueAt: 1,
          submittedAt: 1,
        },
      )
      .sort({ createdAt: -1, _id: -1 })
      .lean<AuditLite[]>();
    const out = new Map<string, AuditLite>();
    for (const row of rows) {
      const k = String(row.dealId);
      if (!out.has(k)) out.set(k, row);
    }
    return out;
  }

  async quotesByLead(
    leadIds: Iterable<IdLike>,
  ): Promise<Map<string, QuoteLite[]>> {
    const ids = uniqueIds(leadIds);
    if (!ids.length) return new Map();
    const rows = await this.models.quoteRecap
      .find(
        { ...this.tenant, leadId: { $in: oids(ids) } },
        { leadId: 1, quoteDateYmd: 1, premium: 1 },
      )
      .sort({ quoteDateYmd: 1, _id: 1 })
      .lean<QuoteLite[]>();
    return groupBy(rows, (row) => row.leadId);
  }

  async dealsBy(
    field: 'leadId' | 'quoteRecapId',
    parentIds: Iterable<IdLike>,
  ): Promise<Map<string, DealLite[]>> {
    const ids = uniqueIds(parentIds);
    if (!ids.length) return new Map();
    const rows = await this.models.deal
      .find(
        { ...this.tenant, [field]: { $in: oids(ids) } },
        {
          leadId: 1,
          quoteRecapId: 1,
          soldDateYmd: 1,
          premium: 1,
          chargebackAdjustment: 1,
        },
      )
      .sort({ soldDateYmd: 1, _id: 1 })
      .lean<DealLite[]>();
    return groupBy(rows, (row) => row[field]);
  }

  /** **Current** memberships only (`endedAt` unset) — who is in the household now. */
  async membershipsBy(
    field: 'householdId' | 'contactId',
    parentIds: Iterable<IdLike>,
  ): Promise<Map<string, MembershipLite[]>> {
    const ids = uniqueIds(parentIds);
    if (!ids.length) return new Map();
    const rows = await this.models.householdMember
      .find(
        { agencyId: this.agencyId, [field]: { $in: oids(ids) }, endedAt: null },
        { householdId: 1, contactId: 1, role: 1 },
      )
      .sort({ addedAt: 1, _id: 1 })
      .lean<MembershipLite[]>();
    return groupBy(rows, (row) => row[field]);
  }

  /** Households whose primary contact is one of these contacts. */
  async householdsByPrimaryContact(
    contactIds: Iterable<IdLike>,
  ): Promise<Map<string, Types.ObjectId[]>> {
    const ids = uniqueIds(contactIds);
    if (!ids.length) return new Map();
    const rows = await this.models.household
      .find(
        { ...this.tenant, primaryContactId: { $in: oids(ids) } },
        { primaryContactId: 1 },
      )
      .lean<{ _id: Types.ObjectId; primaryContactId: Types.ObjectId }[]>();
    const grouped = groupBy(rows, (row) => row.primaryContactId);
    return new Map(
      [...grouped].map(([k, list]) => [k, list.map((row) => row._id)]),
    );
  }

  /** The first interested party (mortgagee) recorded on each policy. */
  async interestedPartyByPolicy(
    policyIds: Iterable<IdLike>,
  ): Promise<Map<string, InterestedPartyLite>> {
    const ids = uniqueIds(policyIds);
    if (!ids.length) return new Map();
    const rows = await this.models.interestedParty
      .find(
        { ...this.tenant, policyId: { $in: oids(ids) } },
        { policyId: 1, mortgagee: 1, loanNumber: 1 },
      )
      .sort({ _id: 1 })
      .lean<InterestedPartyLite[]>();
    const out = new Map<string, InterestedPartyLite>();
    for (const row of rows) {
      const k = String(row.policyId);
      if (!out.has(k)) out.set(k, row);
    }
    return out;
  }

  /** Which of these policies carry a chargeback. */
  async chargebackPolicyIds(policyIds: Iterable<IdLike>): Promise<Set<string>> {
    const ids = uniqueIds(policyIds);
    if (!ids.length) return new Set();
    const rows = await this.models.chargeback
      .find(
        { agencyId: this.agencyId, policyId: { $in: oids(ids) } },
        { policyId: 1 },
      )
      .lean<{ policyId: Types.ObjectId }[]>();
    return new Set(rows.map((row) => String(row.policyId)));
  }
}
