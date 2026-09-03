import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AccessContext,
  ContactSummary,
  DataScope,
  HouseholdListResponse,
  HouseholdListRow,
  HouseholdMatch,
  HouseholdSummary,
  HouseholdView,
  PolicySearchResult,
  PolicySummary,
  PolicyView,
  formatHouseholdRef,
  householdStatusQueryValues,
  normalizeCarrier,
  normalizeContactRole,
  normalizeHouseholdStatus,
  normalizePolicyStatus,
  normalizePolicyType,
  parseHouseholdRef,
  policyNumberKey,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { resolveHouseholdAddress } from '../common/address/household-address';
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema';
import {
  Household,
  HouseholdDocument,
} from '../households/schemas/household.schema';
import {
  normalizeName,
  parseDateOfBirth,
  toDateKey,
} from '../leads/intake/intake.normalize';
import { Policy, PolicyDocument } from '../policies/schemas/policy.schema';
import { AddHouseholdMemberDto } from './dto/add-household-member.dto';
import { ListHouseholdsDto } from './dto/list-households.dto';
import { routeSearchTerm } from './search-routing';

/**
 * Access to client records (households, their members, and their
 * policies).
 *
 * These records are shared across a branch — unlike service tickets they carry
 * no per-user owner — so the `own` data scope has nothing to filter on and
 * deliberately collapses to branch. Anything out of scope is reported as 404
 * rather than 403 so record existence does not leak across tenants.
 */
/**
 * The slice of a `Policy` renewal outreach needs. Dates stay as `Date` (not ISO
 * strings) because the scheduler does arithmetic on them; `branchId` comes
 * through as the plain string this collection stores.
 */
export interface PolicyRenewalCandidate {
  id: string;
  policyNumber: string;
  policyType: string;
  carrier: string;
  premium: number;
  renewalDate: Date | null;
  expirationDate: Date | null;
  householdId: string | null;
  dealId: string | null;
  branchId: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many child records one search term may resolve into an `$in`.
 *
 * A one-letter term would otherwise match every contact in the agency, and the
 * resulting `$in` is both slow to build and slow to serve. Capping means a very
 * broad term returns the first page of matches rather than timing out — which
 * is the right trade for a search box nobody uses one letter at a time.
 */
const CHILD_MATCH_CAP = 500;

/**
 * ⚠ Must match the collation on `ContactSchema`'s
 * `{agencyId, lastName, firstName}` index exactly, or the index is not used.
 */
const CONTACT_NAME_COLLATION = { locale: 'en', strength: 2 } as const;

/** A clause no household satisfies — an explicit empty result. */
const MATCHES_NOTHING = { _id: { $in: [] as Types.ObjectId[] } };

/** `_id` is the tiebreaker everywhere, so pages don't shuffle between requests. */
/**
 * `_id` is the tiebreaker everywhere, so pages don't shuffle between requests.
 *
 * `name` leads with `unnamed`, a computed 0/1 flag, because **MongoDB sorts
 * missing and null values first**. Without it the default view opens on the
 * handful of households the import left with no name — blank rows at the top of
 * the first screen, which reads as a broken page rather than as five bad
 * records. They still appear, just last.
 */
const SORT_SPECS = {
  name: { unnamed: 1, name: 1, _id: 1 },
  policies: { totalActivePolicies: -1, _id: 1 },
  updated: { updatedAt: -1, _id: -1 },
} as const satisfies Record<string, Record<string, 1 | -1>>;

@Injectable()
export class ClientsService {
  constructor(
    @InjectModel(Household.name)
    private householdModel: Model<HouseholdDocument>,
    @InjectModel(Policy.name) private policyModel: Model<PolicyDocument>,
    @InjectModel(Contact.name) private contactModel: Model<ContactDocument>,
  ) {}

  /**
   * Tenant + data-scope filter. NOTE: `TenantRecord.agencyId` / `branchId` are
   * plain strings on these collections (unlike `ServiceTicket`, where they are
   * ObjectIds) — do not cast them.
   */
  private scopeFilter(access: AccessContext): FilterQuery<{
    agencyId: string;
    branchId: string;
  }> {
    if (!access.agencyId) {
      // Defensive; the guards prevent this.
      throw new ForbiddenException('Agency context required');
    }

    const filter: FilterQuery<{ agencyId: string; branchId: string }> = {
      agencyId: access.agencyId,
    };

    if (access.dataScope === DataScope.Agency) {
      return filter;
    }

    // `branch` and `own` both resolve to branch: client records are shared and
    // have no assigned user for `own` to key on.
    if (access.branchId) {
      filter.branchId = access.branchId;
    }
    return filter;
  }

  /**
   * Typeahead over households in scope. An empty term returns the first page
   * so the picker has something to show before the user types.
   */
  async searchHouseholds(
    access: AccessContext,
    term: string,
    limit = 20,
  ): Promise<HouseholdSummary[]> {
    const filter: FilterQuery<HouseholdDocument> = this.scopeFilter(access);
    const q = term.trim();
    if (q) {
      const rx = new RegExp(escapeRegExp(q), 'i');
      filter.$or = [{ name: rx }, { primaryContactName: rx }];
    }

    const households = await this.householdModel
      .find(filter)
      .sort({ name: 1 })
      .limit(clampLimit(limit))
      .lean();
    return households.map(toHouseholdSummary);
  }

  /**
   * The Clients list — `GET /households`, paginated and branch-scoped.
   *
   * Households are the result set, but three of the five things a caller can
   * search for live on *child* records: first/last name and date of birth on
   * `contacts`, the policy number on `policies`. So the search runs in two
   * phases rather than as a `$lookup` — resolve the children to household ids
   * first (capped, so one broad term cannot build an unbounded `$in`), then
   * filter households by those ids alongside their own fields.
   *
   * The two kinds of search compose differently, which is the whole point of
   * having both: `q` is the omni box and **ORs** across every dimension, while
   * the five explicit fields are the advanced panel and **AND** together.
   */
  async listHouseholds(
    access: AccessContext,
    query: ListHouseholdsDto,
  ): Promise<HouseholdListResponse> {
    const { page, pageSize, sort } = query;
    const scope = this.scopeFilter(access);

    /** Conditions that must all hold. Empty means "the whole book in scope". */
    const and: FilterQuery<HouseholdDocument>[] = [];
    /** householdId -> why it matched, for the row's `matchedOn`. */
    const matches = new Map<string, HouseholdMatch>();

    if (query.status?.length) {
      // Each label expands to itself plus any raw SmartSuite code mapping to it,
      // so filtering "Active" also finds the 2,095 households storing `b5qvJ`.
      and.push({
        status: {
          $in: [...new Set(query.status.flatMap(householdStatusQueryValues))],
        },
      });
    }

    // --- Advanced panel: explicit fields, ANDed -----------------------------

    if (query.householdRef !== undefined) {
      const seq = parseHouseholdRef(query.householdRef);
      // A reference that isn't one cannot match anything. Say so with an empty
      // page rather than dropping the filter and returning the whole book — a
      // search that silently widens is the failure worth guarding here.
      and.push(
        seq === null
          ? MATCHES_NOTHING
          : { householdRef: formatHouseholdRef(seq) },
      );
    }

    if (
      query.firstName !== undefined ||
      query.lastName !== undefined ||
      query.dateOfBirth !== undefined
    ) {
      // The DTO has shape-checked the date; `parseDateOfBirth` still returns
      // null for one that is shaped right but impossible (`2025-02-30`).
      const dob = query.dateOfBirth
        ? parseDateOfBirth(query.dateOfBirth)
        : null;
      if (query.dateOfBirth && !dob) {
        and.push(MATCHES_NOTHING);
      } else {
        const byContact = await this.matchByContact(scope, {
          firstName: query.firstName,
          lastName: query.lastName,
          dateOfBirth: dob,
        });
        mergeMatches(matches, byContact);
        and.push(householdIdClause(byContact));
      }
    }

    if (query.policyNumber !== undefined) {
      const key = policyNumberKey(query.policyNumber);
      if (!key) {
        and.push(MATCHES_NOTHING);
      } else {
        const byPolicy = await this.matchByPolicy(scope, key);
        mergeMatches(matches, byPolicy);
        and.push(householdIdClause(byPolicy));
      }
    }

    // --- Omni box: shape-routed, ORed --------------------------------------

    if (query.q) {
      const routes = routeSearchTerm(query.q);
      const or: FilterQuery<HouseholdDocument>[] = [];

      if (routes.name) {
        const rx = new RegExp(escapeRegExp(routes.name), 'i');
        or.push({ name: rx }, { primaryContactName: rx });
        const byName = await this.matchByContact(scope, {
          anyName: routes.name,
        });
        mergeMatches(matches, byName);
        if (byName.size) or.push(householdIdClause(byName));
      }

      if (routes.householdRef) {
        // No `matchedOn`: the reference is printed in the row's first column.
        or.push({ householdRef: routes.householdRef });
      }

      if (routes.dateOfBirth) {
        const byDob = await this.matchByContact(scope, {
          dateOfBirth: routes.dateOfBirth,
        });
        mergeMatches(matches, byDob);
        if (byDob.size) or.push(householdIdClause(byDob));
      }

      if (routes.policyKey) {
        const byPolicy = await this.matchByPolicy(scope, routes.policyKey);
        mergeMatches(matches, byPolicy);
        if (byPolicy.size) or.push(householdIdClause(byPolicy));
      }

      // Every route came back empty — the term matches nothing, which is not
      // the same as no term at all.
      and.push(or.length ? { $or: or } : MATCHES_NOTHING);
    }

    const filter: FilterQuery<HouseholdDocument> = {
      ...scope,
      ...(and.length ? { $and: and } : {}),
    };

    const total = await this.householdModel.countDocuments(filter);

    /*
     * An aggregation rather than `find().sort()` solely so the name sort can
     * put nameless households last (see `SORT_SPECS`) — `$sort` cannot express
     * "nulls last", so the flag has to be computed first.
     *
     * That computed stage means this sort is not index-backed. Fine at agency
     * scale — a few thousand households sort well inside the 100MB limit — but
     * if a book ever grows past six figures, the fix is a stored sort key
     * maintained on write, not a bigger `allowDiskUse`.
     */
    const households = await this.householdModel
      .aggregate<Household & { _id: Types.ObjectId; updatedAt?: Date }>([
        { $match: filter },
        { $addFields: { unnamed: { $cond: [{ $gt: ['$name', ''] }, 0, 1] } } },
        { $sort: SORT_SPECS[sort] },
        { $skip: (page - 1) * pageSize },
        { $limit: pageSize },
        { $unset: 'unnamed' },
      ])
      .exec();

    return {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      items: households.map((household) =>
        toHouseholdListRow(
          household,
          matches.get(String(household._id)) ?? null,
        ),
      ),
    };
  }

  /**
   * Households whose *members* match, mapped to the member that matched.
   *
   * Returns the matching contact rather than a bare `distinct('householdId')`
   * so the list can say *why* a household is in the results — a household found
   * by a child's date of birth otherwise looks like a stray row.
   */
  private async matchByContact(
    scope: FilterQuery<{ agencyId: string; branchId: string }>,
    criteria: {
      firstName?: string;
      lastName?: string;
      anyName?: string;
      dateOfBirth?: Date | null;
    },
  ): Promise<Map<string, HouseholdMatch>> {
    const filter: FilterQuery<ContactDocument> = {
      ...scope,
      householdId: { $ne: null },
    };
    let byName = false;

    if (criteria.firstName) {
      filter.firstName = new RegExp(escapeRegExp(criteria.firstName), 'i');
      byName = true;
    }
    if (criteria.lastName) {
      filter.lastName = new RegExp(escapeRegExp(criteria.lastName), 'i');
      byName = true;
    }
    if (criteria.anyName) {
      const rx = new RegExp(escapeRegExp(criteria.anyName), 'i');
      filter.$or = [{ firstName: rx }, { lastName: rx }];
      byName = true;
    }
    if (criteria.dateOfBirth) {
      // A day range, never equality on a parsed string: `dateOfBirth` is stored
      // at UTC midnight, and anything built through the local timezone lands a
      // day off for half the book.
      filter.dateOfBirth = {
        $gte: criteria.dateOfBirth,
        $lt: new Date(criteria.dateOfBirth.getTime() + DAY_MS),
      };
    }

    const cursor = this.contactModel
      .find(filter)
      .select('firstName lastName dateOfBirth householdId')
      .limit(CHILD_MATCH_CAP);

    // ⚠ The `{agencyId, lastName, firstName}` index carries this collation, and
    // a name query that omits it silently reverts to case-sensitive matching
    // *and* falls back to a collection scan — so "mcdonald" would miss
    // "McDonald" slowly. See the docblock on `ContactSchema`.
    if (byName) cursor.collation(CONTACT_NAME_COLLATION);

    const contacts = await cursor.lean();

    const found = new Map<string, HouseholdMatch>();
    for (const contact of contacts) {
      if (!contact.householdId) continue;
      const key = String(contact.householdId);
      // First contact wins: one label per household, and the query is already
      // ordered by whatever the index handed back.
      if (found.has(key)) continue;

      const name = contactDisplayName(contact) ?? 'Unnamed member';
      const dob = toDateKey(contact.dateOfBirth);
      found.set(
        key,
        criteria.dateOfBirth && !byName
          ? { field: 'dateOfBirth', value: dob ? `${name} · ${dob}` : name }
          : { field: 'member', value: name },
      );
    }
    return found;
  }

  /**
   * Households owning a policy whose number matches, mapped to that policy.
   *
   * Matched on `policyNumberKey` — the stored number uppercased with
   * non-alphanumerics stripped — so a caller typing `AS 123-4567` finds
   * `AS1234567`. The regex is anchored, which is what lets
   * `{agencyId, policyNumberKey}` serve it as a prefix scan instead of reading
   * the collection.
   */
  private async matchByPolicy(
    scope: FilterQuery<{ agencyId: string; branchId: string }>,
    key: string,
  ): Promise<Map<string, HouseholdMatch>> {
    const policies = await this.policyModel
      .find({
        ...scope,
        policyNumberKey: new RegExp(`^${escapeRegExp(key)}`),
        householdId: { $ne: null },
      })
      .select('policyNumber policyNumberKey householdId')
      .limit(CHILD_MATCH_CAP)
      .lean();

    const found = new Map<string, HouseholdMatch>();
    for (const policy of policies) {
      if (!policy.householdId) continue;
      const householdKey = String(policy.householdId);
      if (found.has(householdKey)) continue;
      found.set(householdKey, {
        field: 'policy',
        value: policy.policyNumber ?? policy.policyNumberKey ?? 'Policy',
      });
    }
    return found;
  }

  /**
   * Typeahead over policies in scope, by policy number, type, carrier, or the
   * name of the household that owns them.
   *
   * The household is in the OR because the picker *labels every row with it*:
   * a user looking at a list of client names types one, and matching only the
   * policy's own fields answers that with "No policies match". Resolved in a
   * separate query rather than a `$lookup` — same two-phase shape as
   * {@link listHouseholds}, and capped so one broad term cannot build an
   * unbounded `$in`.
   *
   * `householdId` narrows the search to a single household — the New Ticket
   * dialog opened from a household page passes it so the picker cannot offer
   * another client's policy. An id that is malformed or out of scope yields an
   * empty list rather than the unfiltered book: a picker that silently widens
   * on a bad id is the failure this filter exists to prevent.
   */
  async searchPolicies(
    access: AccessContext,
    term: string,
    limit = 20,
    householdId?: string,
  ): Promise<PolicySearchResult[]> {
    const scope = this.scopeFilter(access);
    const filter: FilterQuery<PolicyDocument> = { ...scope };
    const q = term.trim();
    if (q) {
      const rx = new RegExp(escapeRegExp(q), 'i');
      const or: FilterQuery<PolicyDocument>[] = [
        { policyNumber: rx },
        { policyType: rx },
        { carrier: rx },
      ];
      // Only when the name matched something: an empty `$in` is a clause no
      // policy satisfies, and ORing it in would be harmless but pointless.
      const byHousehold = await this.matchHouseholdsByName(scope, rx);
      if (byHousehold.length) {
        or.push({ householdId: { $in: byHousehold } });
      }
      filter.$or = or;
    }
    if (householdId !== undefined) {
      if (!Types.ObjectId.isValid(householdId)) {
        return [];
      }
      filter.householdId = new Types.ObjectId(householdId);
    }

    const policies = await this.policyModel
      .find(filter)
      .sort({ active: -1, policyNumber: 1 })
      .limit(clampLimit(limit))
      .lean();

    // Resolve the owning households in one round-trip for the picker labels.
    const householdIds = policies
      .map((p) => p.householdId)
      .filter((id): id is Types.ObjectId => Boolean(id));
    const households = householdIds.length
      ? await this.householdModel
          .find({ ...scope, _id: { $in: householdIds } })
          .select('name')
          .lean()
      : [];
    const nameById = new Map(
      households.map((h) => [String(h._id), h.name ?? null]),
    );

    return policies.map((policy) => ({
      ...toPolicySummary(policy),
      householdId: policy.householdId ? String(policy.householdId) : null,
      householdName: policy.householdId
        ? (nameById.get(String(policy.householdId)) ?? null)
        : null,
    }));
  }

  /**
   * Ids of the households in scope whose own name or primary contact matches.
   *
   * Capped like every other child resolution here: the cap bounds the `$in`
   * the caller builds, not the result the user sees.
   */
  private async matchHouseholdsByName(
    scope: FilterQuery<HouseholdDocument>,
    rx: RegExp,
  ): Promise<Types.ObjectId[]> {
    const households = await this.householdModel
      .find({ ...scope, $or: [{ name: rx }, { primaryContactName: rx }] })
      .select('_id')
      .limit(CHILD_MATCH_CAP)
      .lean();
    return households.map((household) => household._id);
  }

  /**
   * Active policies whose renewal falls inside a window, for proactive renewal
   * outreach.
   *
   * A *method*, not an endpoint: the renewal horizon is an internal concern of
   * the CRM module, and exposing it as a route would duplicate that logic in
   * two places with no owner. More importantly it keeps the tenancy cast in
   * this file — `Policy.agencyId` is a plain **string** here, and a wrong cast
   * returns zero documents with no error, which surfaces as an empty desk that
   * nobody notices for weeks.
   *
   * Backed by `{agencyId, active, renewalDate}` on `policies`; `limit` bounds
   * one pass so a large book converges over several requests rather than
   * blocking one.
   */
  async findRenewalWindow(
    access: AccessContext,
    from: Date,
    to: Date,
    limit = 500,
  ): Promise<PolicyRenewalCandidate[]> {
    const scope = this.scopeFilter(access);
    const policies = await this.policyModel
      .find({
        ...scope,
        active: true,
        renewalDate: { $ne: null, $gte: from, $lte: to },
      })
      .sort({ renewalDate: 1 })
      .limit(limit)
      .lean();

    return policies.map((policy) => ({
      id: String(policy._id),
      policyNumber: policy.policyNumber ?? '',
      policyType: policy.policyType ?? '',
      carrier: policy.carrier ?? '',
      premium: policy.premium ?? 0,
      renewalDate: policy.renewalDate ?? null,
      expirationDate: policy.expirationDate ?? null,
      householdId: policy.householdId ? String(policy.householdId) : null,
      dealId: policy.dealId ? String(policy.dealId) : null,
      branchId: policy.branchId ?? null,
    }));
  }

  /**
   * The same shape by id, for reconciling a cycle whose policies may have been
   * deactivated or deleted since it was created. Out-of-scope and missing ids
   * are simply absent from the result.
   */
  async findRenewalCandidatesByIds(
    access: AccessContext,
    ids: string[],
  ): Promise<PolicyRenewalCandidate[]> {
    const objectIds = ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (!objectIds.length) {
      return [];
    }

    const policies = await this.policyModel
      .find({ ...this.scopeFilter(access), _id: { $in: objectIds } })
      .lean();

    return policies
      .filter((policy) => policy.active)
      .map((policy) => ({
        id: String(policy._id),
        policyNumber: policy.policyNumber ?? '',
        policyType: policy.policyType ?? '',
        carrier: policy.carrier ?? '',
        premium: policy.premium ?? 0,
        renewalDate: policy.renewalDate ?? null,
        expirationDate: policy.expirationDate ?? null,
        householdId: policy.householdId ? String(policy.householdId) : null,
        dealId: policy.dealId ? String(policy.dealId) : null,
        branchId: policy.branchId ?? null,
      }));
  }

  async getHousehold(
    access: AccessContext,
    id: string,
  ): Promise<HouseholdView> {
    const scope = this.scopeFilter(access);
    // Guard the cast so a malformed id 404s instead of throwing a CastError.
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Household not found');
    }

    const household = await this.householdModel
      .findOne({ ...scope, _id: new Types.ObjectId(id) })
      .lean();
    if (!household) {
      throw new NotFoundException('Household not found');
    }

    const householdId = new Types.ObjectId(id);
    const [contacts, policies] = await Promise.all([
      this.contactModel
        .find({ ...scope, householdId })
        .sort({ isPrimary: -1, lastName: 1 })
        .lean(),
      this.policyModel
        .find({ ...scope, householdId })
        .sort({ active: -1, renewalDate: 1 })
        .lean(),
    ]);

    return {
      ...toHouseholdSummary(household),
      propertyAddress: household.propertyAddress ?? null,
      mailingAddress: household.mailingAddress ?? null,
      primaryEmails: household.primaryEmails ?? [],
      primaryPhones: household.primaryPhones ?? [],
      assignedCrmId: household.assignedCrmId
        ? String(household.assignedCrmId)
        : null,
      contacts: contacts.map(toContactSummary),
      policies: policies.map(toPolicySummary),
    };
  }

  /**
   * Add a member to a household — the "+ Member" dialog on the Household page.
   *
   * A member **is** a `Contact`; there is no separate member record. The write
   * is therefore two documents: the contact, and the household's
   * `memberContactIds`. Both are needed — the contact's `householdId` is what
   * the household page reads, while `memberContactIds` is what the lead-intake
   * pipeline and the migration maintain, and letting them disagree is how a
   * member becomes visible on one screen and not another.
   *
   * Tenancy comes from the household, never from the caller: a producer whose
   * branch differs from the household's would otherwise stamp a contact into a
   * branch the household does not belong to, and that contact would then be
   * invisible to everyone reading the household.
   *
   * Deliberately **not** deduplicated against existing contacts, unlike
   * `ResolveContactStep`. That matcher exists because a public form is filled
   * by strangers who may already be in the book; this dialog is a human on the
   * household's own page, who can see the current members listed beside the
   * button. Silently merging their new "Child · Sam" into an existing Sam
   * would be the surprising outcome here.
   */
  async addHouseholdMember(
    access: AccessContext,
    householdId: string,
    dto: AddHouseholdMemberDto,
  ): Promise<ContactSummary> {
    const scope = this.scopeFilter(access);
    if (!Types.ObjectId.isValid(householdId)) {
      throw new NotFoundException('Household not found');
    }

    const household = await this.householdModel.findOne({
      ...scope,
      _id: new Types.ObjectId(householdId),
    });
    if (!household) {
      throw new NotFoundException('Household not found');
    }

    const contact = await this.contactModel.create({
      agencyId: household.agencyId,
      branchId: household.branchId,
      firstName: normalizeName(dto.firstName),
      lastName: normalizeName(dto.lastName),
      // Parsed to UTC midnight from explicit components — never
      // `new Date(str)`, which shifts a birthday a day west of Greenwich.
      dateOfBirth: dto.dateOfBirth
        ? (parseDateOfBirth(dto.dateOfBirth) ?? undefined)
        : undefined,
      roleInHousehold: dto.role,
      // Never primary: that role belongs to the household's Named Insured, and
      // the dialog does not offer it (see `add-household-member.dto.ts`).
      isPrimary: false,
      householdId: household._id,
      emails: [],
      phones: [],
      isTestRecord: false,
    });

    await this.householdModel.updateOne(
      { _id: household._id },
      { $addToSet: { memberContactIds: contact._id } },
    );

    return toContactSummary(contact.toObject());
  }

  async getPolicy(access: AccessContext, id: string): Promise<PolicyView> {
    const scope = this.scopeFilter(access);
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Policy not found');
    }

    const policy = await this.policyModel
      .findOne({ ...scope, _id: new Types.ObjectId(id) })
      .lean();
    if (!policy) {
      throw new NotFoundException('Policy not found');
    }

    // Re-apply the scope filter to the parent so a household outside the
    // caller's branch simply reads as absent.
    const household = policy.householdId
      ? await this.householdModel
          .findOne({ ...scope, _id: policy.householdId })
          .lean()
      : null;

    return {
      ...toPolicySummary(policy),
      notes: policy.notes ?? null,
      household: household ? toHouseholdSummary(household) : null,
    };
  }
}

function toHouseholdSummary(
  household: Household & { _id: unknown },
): HouseholdSummary {
  return {
    id: String(household._id),
    name: household.name ?? null,
    // Normalized on read as well as on import (PAC-80). The re-import heals this
    // database; this is what keeps a code renderable in one migrated by older
    // code, and what stops `b5qvJ` reaching a badge if one ever reappears.
    status: normalizeHouseholdStatus(household.status) || null,
    primaryContactName: household.primaryContactName ?? null,
    totalActivePolicies: household.totalActivePolicies ?? 0,
  };
}

function toPolicySummary(policy: Policy & { _id: unknown }): PolicySummary {
  return {
    id: String(policy._id),
    policyNumber: policy.policyNumber ?? null,
    policyType: normalizePolicyType(policy.policyType) || null,
    carrier: normalizeCarrier(policy.carrier) || null,
    active: policy.active ?? false,
    policyStatus: normalizePolicyStatus(policy.policyStatus) || null,
    premium: policy.premium ?? 0,
    items: policy.items ?? 0,
    effectiveDate: toIso(policy.effectiveDate),
    expirationDate: toIso(policy.expirationDate),
    renewalDate: toIso(policy.renewalDate),
  };
}

function toContactSummary(contact: Contact & { _id: unknown }): ContactSummary {
  return {
    id: String(contact._id),
    firstName: contact.firstName ?? null,
    lastName: contact.lastName ?? null,
    emails: contact.emails ?? [],
    phones: contact.phones ?? [],
    roleInHousehold: normalizeContactRole(contact.roleInHousehold) || null,
    isPrimary: contact.isPrimary ?? false,
    dateOfBirth: toIso(contact.dateOfBirth),
  };
}

function toIso(value: Date | undefined | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function toHouseholdListRow(
  household: Household & { _id: unknown; updatedAt?: Date },
  matchedOn: HouseholdMatch | null,
): HouseholdListRow {
  // Coerced here rather than in the client: the three writers of
  // `propertyAddress` each use their own key names, and every consumer that
  // re-implemented that lookup table got at least one of them wrong.
  const address = resolveHouseholdAddress(
    null,
    household.propertyAddress,
    household.mailingAddress,
  );

  return {
    ...toHouseholdSummary(household),
    householdRef: household.householdRef ?? null,
    // The list shows one of each; the detail page shows them all.
    primaryEmail: household.primaryEmails?.[0] ?? null,
    primaryPhone: household.primaryPhones?.[0] ?? null,
    city: address?.city || null,
    state: address?.state || null,
    assignedCrmId: household.assignedCrmId
      ? String(household.assignedCrmId)
      : null,
    updatedAt: toIso(household.updatedAt),
    matchedOn,
  };
}

/** `null` when there is no name to show. */
function contactDisplayName(contact: {
  firstName?: string | null;
  lastName?: string | null;
}): string | null {
  return (
    [contact.firstName, contact.lastName]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(' ') || null
  );
}

/**
 * Fold child matches into the running map. Earlier writers win, so the panel's
 * explicit fields keep their label when the omni box matches the same household
 * for a different reason.
 */
function mergeMatches(
  target: Map<string, HouseholdMatch>,
  found: Map<string, HouseholdMatch>,
): void {
  for (const [key, match] of found) {
    if (!target.has(key)) target.set(key, match);
  }
}

/** The `_id: { $in: [...] }` clause for a set of resolved household ids. */
function householdIdClause(
  found: Map<string, HouseholdMatch>,
): FilterQuery<HouseholdDocument> {
  return {
    _id: { $in: [...found.keys()].map((id) => new Types.ObjectId(id)) },
  };
}

/** Search terms are user input — never let them compile as a pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clampLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit) || 20, 1), 50);
}
