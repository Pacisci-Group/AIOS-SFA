import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AccessContext,
  ContactSummary,
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
  nextRenewalDate,
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
import {
  loadContactDetails,
  toContactDetails,
  type ContactDetails,
} from '../contacts/contact-details';
import { ContactIdentityService } from '../contacts/contact-identity.service';
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema';
import {
  HouseholdMembersService,
  rolesByContact,
} from '../households/household-members.service';
import { pickPrimaryContact } from '../households/primary-contact';
import { PrimaryContactService } from '../households/primary-contact.service';
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
import {
  clientAgencyId,
  clientScopeFilter,
  type ClientScopeFilter,
} from './client-scope';
import { AddHouseholdMemberDto } from './dto/add-household-member.dto';
import { ListHouseholdsDto } from './dto/list-households.dto';
import { SetPrimaryContactDto } from './dto/set-primary-contact.dto';
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
    private readonly identity: ContactIdentityService,
    private readonly memberships: HouseholdMembersService,
    private readonly primaryContacts: PrimaryContactService,
  ) {}

  /**
   * Tenant + data-scope filter. NOTE: `TenantRecord.agencyId` / `branchId` are
   * plain strings on these collections (unlike `ServiceTicket`, where they are
   * ObjectIds) — do not cast them.
   *
   * The rule itself lives in `client-scope.ts` since `UnlinkedRecordsService`
   * came to need the same one (PAC-91 §10); these two stay as thin private
   * methods because every call site in this file reads better for them.
   */
  private agencyIdOf(access: AccessContext): string {
    return clientAgencyId(access);
  }

  private scopeFilter(access: AccessContext): ClientScopeFilter {
    return clientScopeFilter(access);
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
    const scope = this.scopeFilter(access);
    const filter: FilterQuery<HouseholdDocument> = { ...scope };
    const q = term.trim();
    if (q) {
      // The household no longer stores `primaryContactName` (PAC-91 §4), so a
      // name term reaches the primary contact the same way the Clients list
      // does — by resolving contacts first and matching on the household ids
      // they name.
      const rx = new RegExp(escapeRegExp(q), 'i');
      const ids = await this.matchHouseholdsByContactName(scope, rx);
      filter.$or = [
        { name: rx },
        ...(ids.length ? [{ _id: { $in: ids } }] : []),
      ];
    }

    const households = await this.householdModel
      .find(filter)
      .sort({ name: 1 })
      .limit(clampLimit(limit))
      .lean();
    return this.withPrimaryContacts(households, toHouseholdSummary);
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
        const byContact = await this.matchByContact(
          this.agencyIdOf(access),
          scope,
          {
            firstName: query.firstName,
            lastName: query.lastName,
            dateOfBirth: dob,
          },
        );
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
        // No `primaryContactName` clause any more (PAC-91 §4) — and none is
        // needed: `matchByContact` below already searches every member's name,
        // the primary included, and returns a `matchedOn` label the stored copy
        // never could.
        or.push({ name: rx });
        const byName = await this.matchByContact(
          this.agencyIdOf(access),
          scope,
          {
            anyName: routes.name,
          },
        );
        mergeMatches(matches, byName);
        if (byName.size) or.push(householdIdClause(byName));
      }

      if (routes.householdRef) {
        // No `matchedOn`: the reference is printed in the row's first column.
        or.push({ householdRef: routes.householdRef });
      }

      if (routes.dateOfBirth) {
        const byDob = await this.matchByContact(
          this.agencyIdOf(access),
          scope,
          {
            dateOfBirth: routes.dateOfBirth,
          },
        );
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
      items: await this.withPrimaryContacts(households, (household, primary) =>
        toHouseholdListRow(
          household,
          matches.get(String(household._id)) ?? null,
          primary,
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
   *
   * Goes contact → membership → household since PAC-91 §5. The contact no
   * longer carries a household of its own, and a matching contact can now put
   * **several** households in the results: an adult child on their parents'
   * policy and on their own is a hit for both, which is the honest answer and
   * was unreachable while one link per person was all there was.
   */
  private async matchByContact(
    agencyId: string,
    scope: FilterQuery<{ agencyId: string; branchId: string }>,
    criteria: {
      firstName?: string;
      lastName?: string;
      anyName?: string;
      dateOfBirth?: Date | null;
    },
  ): Promise<Map<string, HouseholdMatch>> {
    const filter: FilterQuery<ContactDocument> = { ...scope };
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
      .select('firstName lastName dateOfBirth')
      .limit(CHILD_MATCH_CAP);

    // ⚠ The `{agencyId, lastName, firstName}` index carries this collation, and
    // a name query that omits it silently reverts to case-sensitive matching
    // *and* falls back to a collection scan — so "mcdonald" would miss
    // "McDonald" slowly. See the docblock on `ContactSchema`.
    if (byName) cursor.collation(CONTACT_NAME_COLLATION);

    const contacts = await cursor.lean();
    if (!contacts.length) return new Map();

    const byContact = await this.memberships.mapByContacts(
      agencyId,
      contacts.map((contact) => contact._id),
    );

    const found = new Map<string, HouseholdMatch>();
    for (const contact of contacts) {
      const name = contactDisplayName(contact) ?? 'Unnamed member';
      const dob = toDateKey(contact.dateOfBirth);
      const match: HouseholdMatch =
        criteria.dateOfBirth && !byName
          ? { field: 'dateOfBirth', value: dob ? `${name} · ${dob}` : name }
          : { field: 'member', value: name };

      for (const membership of byContact.get(String(contact._id)) ?? []) {
        const key = String(membership.householdId);
        // First contact wins: one label per household, and the query is already
        // ordered by whatever the index handed back.
        if (found.has(key)) continue;
        found.set(key, match);
      }
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
    const [byOwnName, byContactName] = await Promise.all([
      this.householdModel
        .find({ ...scope, name: rx })
        .select('_id')
        .limit(CHILD_MATCH_CAP)
        .lean(),
      this.matchHouseholdsByContactName(scope, rx),
    ]);

    const seen = new Set<string>();
    const out: Types.ObjectId[] = [];
    for (const id of [
      ...byOwnName.map((household) => household._id),
      ...byContactName,
    ]) {
      const key = String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(id);
    }
    return out;
  }

  /**
   * Households whose **primary contact's** name matches.
   *
   * The lookup the dropped `Household.primaryContactName` used to serve
   * (PAC-91 §4). Note it goes contact → household rather than the reverse: a
   * contact's name is indexed (with the collation this repeats), and matching
   * on `primaryContactId` afterwards is what makes "primary" mean the
   * household's own primary rather than any member who happens to share the
   * name.
   */
  private async matchHouseholdsByContactName(
    scope: FilterQuery<{ agencyId: string; branchId: string }>,
    rx: RegExp,
  ): Promise<Types.ObjectId[]> {
    const contacts = await this.contactModel
      .find({ ...scope, $or: [{ firstName: rx }, { lastName: rx }] })
      .select('_id')
      // ⚠ Must match the `{agencyId, lastName, firstName}` index — see
      // `CONTACT_NAME_COLLATION`.
      .collation(CONTACT_NAME_COLLATION)
      .limit(CHILD_MATCH_CAP)
      .lean();
    if (!contacts.length) return [];

    const households = await this.householdModel
      .find({
        ...scope,
        primaryContactId: { $in: contacts.map((contact) => contact._id) },
      })
      .select('_id')
      .limit(CHILD_MATCH_CAP)
      .lean();
    return households.map((household) => household._id);
  }

  /**
   * Attach each household's primary-contact details, in one extra query for the
   * whole page.
   *
   * The three fields the household used to store copies of — name, email and
   * phone — are now read through `primaryContactId` (PAC-91 §1, §4). Every
   * household-shaped response goes through here so none of them can quietly go
   * back to rendering an em dash for a migrated record.
   */
  private async withPrimaryContacts<T>(
    households: Array<Household & { _id: Types.ObjectId }>,
    map: (
      household: Household & { _id: Types.ObjectId },
      primary: ContactDetails | undefined,
    ) => T,
  ): Promise<T[]> {
    const byContactId = await loadContactDetails(
      this.contactModel,
      households.map((household) => household.primaryContactId),
    );
    return households.map((household) =>
      map(
        household,
        household.primaryContactId
          ? byContactId.get(String(household.primaryContactId))
          : undefined,
      ),
    );
  }

  /**
   * Advance policies whose stored renewal date has gone by, and fill in ones
   * that never had it.
   *
   * `policies.renewalDate` is a **derived cache**: the next occurrence of a
   * term that repeats forever, not a fact a carrier sends once. Two things
   * would otherwise leave it wrong:
   *
   *   - A renewal passes. The policy drops out of the outreach window 14 days
   *     later and, with nothing to move it on, is never seen again — one term
   *     of outreach, then silence for the life of the policy.
   *   - A policy has no `renewalDate` at all: everything the SmartSuite import
   *     brought over, since that column held the *effective* date, and until
   *     the write paths were fixed, everything sold through the app.
   *
   * Rolling forward from the existing `renewalDate` when there is one keeps a
   * policy on the cycle it is genuinely on, and needs no join. Falling back to
   * `effectiveDate` — then `expirationDate`, which is what
   * `renewalAnchorDate` has always documented — is what repairs the rest.
   * A policy with none of the three is left alone: there is nothing to count
   * down to, and a guessed date would schedule real calls to real clients.
   *
   * Bounded per pass, and ordered so the null and most-overdue rows are
   * repaired first. Uses `bulkWrite` deliberately: this is a system-derived
   * field, and stamping `updatedBy` with whichever CSR happened to load the
   * desk would put a person's name on a write they did not make.
   *
   * @returns how many policies were advanced.
   */
  async rollForwardRenewalDates(
    access: AccessContext,
    now: Date,
    limit = 500,
  ): Promise<number> {
    const scope = this.scopeFilter(access);
    const stale = await this.policyModel
      .find({
        ...scope,
        active: true,
        $or: [{ renewalDate: null }, { renewalDate: { $lt: now } }],
      })
      .select('policyType renewalDate effectiveDate expirationDate')
      .sort({ renewalDate: 1 })
      .limit(limit)
      .lean();

    const writes = stale.flatMap((policy) => {
      const anchor =
        policy.renewalDate ?? policy.effectiveDate ?? policy.expirationDate;
      const next = nextRenewalDate(anchor, policy.policyType, now);
      // No anchor, or one too far gone to reach the present — leave it be and
      // let the migration's report be what surfaces it.
      if (!next) return [];
      return [
        {
          updateOne: {
            filter: { _id: policy._id },
            update: { $set: { renewalDate: next } },
          },
        },
      ];
    });

    if (!writes.length) return 0;
    await this.policyModel.bulkWrite(writes);
    return writes.length;
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
   *
   * ⚠ `limit` bounds the pass, so **the caller must pass `after` to page**.
   * Ordered by `renewalDate`, an unpaged call returns the same earliest `limit`
   * policies every time; a window holding more than that would never have its
   * tail scanned. `after` resumes the sweep just past the last renewal date
   * seen — see `RenewalScanState.scanCursor`.
   *
   * Only `renewalDate` is matched, deliberately. It used to be the *only*
   * populated anchor for part of the book while `renewalAnchorDate` documented
   * an `expirationDate` fallback the query silently defeated. That gap is now
   * closed upstream: the scan's roll-forward pass fills `renewalDate` from
   * whichever anchor a policy has, so by the time this runs every eligible
   * policy carries one and a single indexed range is both correct and complete.
   */
  async findRenewalWindow(
    access: AccessContext,
    from: Date,
    to: Date,
    limit = 500,
    after: Date | null = null,
  ): Promise<PolicyRenewalCandidate[]> {
    const scope = this.scopeFilter(access);
    // `after` is a renewal *date*, not a unique key, so resuming strictly past
    // it would drop every policy sharing that date with the last one seen —
    // and renewal dates collide constantly. Re-reading them is the safe side of
    // the trade: `ensureRenewalCycle` is idempotent, so a repeat costs a lookup.
    const lowerBound = after && after > from ? after : from;
    const policies = await this.policyModel
      .find({
        ...scope,
        active: true,
        renewalDate: { $ne: null, $gte: lowerBound, $lte: to },
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
    const [memberships, policies] = await Promise.all([
      this.memberships.listByHousehold(this.agencyIdOf(access), householdId),
      this.policyModel
        .find({ ...scope, householdId })
        .sort({ active: -1, renewalDate: 1 })
        .lean(),
    ]);

    /*
     * The roster comes from `householdMembers` (PAC-91 §5) — the contact no
     * longer carries a household, and could only ever have carried one. The
     * `.sort({ isPrimary: -1, … })` this replaces sorted on a flag that meant
     * "primary of *some* household", so a driver who heads their own household
     * led the roster of one they merely belong to.
     *
     * Re-filtered by `scope`, so a member outside the caller's branch reads as
     * absent rather than leaking across it.
     */
    const contacts = memberships.length
      ? await this.contactModel
          .find({
            ...scope,
            _id: { $in: memberships.map((member) => member.contactId) },
          })
          .sort({ lastName: 1 })
          .lean()
      : [];
    const roles = rolesByContact(memberships);

    /*
     * Resolved here rather than in each client. Both the Household page and the
     * ticket drawer used to run `primaryContactName ?? contacts.find(isPrimary)`
     * themselves and both rendered an em dash for the same records: the
     * SmartSuite import wrote no `primaryContactName`, and `contact.isPrimary`
     * comes from a checkbox that is often unset. `primaryContactId` — which
     * neither client could see — is the answer for the rest of them, and since
     * PAC-91 §4 it is the *only* answer: the stored copy is gone.
     *
     * No extra query for it here, unlike the list paths: the whole roster is
     * already loaded, so the primary is one of the documents in hand.
     */
    const primary = pickPrimaryContact(contacts, household.primaryContactId);
    const primaryId = primary ? String(primary._id) : null;

    return {
      ...toHouseholdSummary(household, toContactDetails(primary)),
      // Coerced once, on the way out: the three writers' key sets are an API
      // concern, and every client that re-implemented the lookup table got at
      // least one of them wrong. No lead in scope here, hence the leading null.
      address: resolveHouseholdAddress(
        null,
        household.propertyAddress,
        household.mailingAddress,
      ),
      propertyAddress: household.propertyAddress ?? null,
      mailingAddress: household.mailingAddress ?? null,
      primaryEmail: primary?.email ?? null,
      primaryPhone: primary?.phone ?? null,
      assignedCrmId: household.assignedCrmId
        ? String(household.assignedCrmId)
        : null,
      // Primary first, then the `lastName: 1` order the query returned — the
      // roster leads with the named insured, and `isPrimary` is derived per
      // household so exactly one contact in this response carries it.
      contacts: orderPrimaryFirst(contacts, primaryId).map((contact) =>
        toContactSummary(
          contact,
          String(contact._id) === primaryId,
          roles.get(String(contact._id)),
        ),
      ),
      policies: policies.map(toPolicySummary),
    };
  }

  /**
   * Add a member to a household — the "+ Member" dialog on the Household page.
   *
   * The write is two documents: the `Contact` — the person — and a row in
   * `householdMembers` — their membership of *this* household, carrying the
   * role (PAC-91 §5). It used to be the contact plus two half-links that
   * nothing reconciled (`contact.householdId` and
   * `household.memberContactIds`), which is how a member could be visible on
   * one screen and not another.
   *
   * Tenancy comes from the household, never from the caller: a producer whose
   * branch differs from the household's would otherwise stamp a contact into a
   * branch the household does not belong to, and that contact would then be
   * invisible to everyone reading the household.
   *
   * Deliberately **not** put through `ResolveContactStep`'s fuzzy matcher. That
   * matcher exists because a public form is filled by strangers who may already
   * be in the book; this dialog is a human on the household's own page, who can
   * see the current members listed beside the button. Silently merging their
   * new "Child · Sam" into an existing Sam would be the surprising outcome
   * here.
   *
   * It *is* checked against the owner's identity rule (PAC-91 §9), which is a
   * different thing: a full-key hit is not a guess, and the 409 hands back the
   * existing contact id so the UI can offer to use it. In practice this dialog
   * collects no email or phone, so the rule is usually incomplete and the check
   * is a no-op — it is here so that stops being true the moment the dialog
   * grows those fields, rather than one release later.
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

    const person = {
      firstName: normalizeName(dto.firstName),
      lastName: normalizeName(dto.lastName),
      // Parsed to UTC midnight from explicit components — never
      // `new Date(str)`, which shifts a birthday a day west of Greenwich.
      dateOfBirth: dto.dateOfBirth
        ? (parseDateOfBirth(dto.dateOfBirth) ?? undefined)
        : undefined,
    };

    await this.identity.assertNoDuplicate(household.agencyId, person);

    const contact = await this.contactModel.create({
      agencyId: household.agencyId,
      branchId: household.branchId,
      ...person,
      isTestRecord: false,
    });

    await this.memberships.add({
      agencyId: household.agencyId,
      branchId: household.branchId,
      householdId: household._id,
      contactId: contact._id,
      role: dto.role,
      source: 'manual',
    });

    // Never primary: that role belongs to the household's Named Insured, and
    // the dialog does not offer it (see `add-household-member.dto.ts`).
    return toContactSummary(contact.toObject(), false, dto.role);
  }

  /**
   * Name the household's primary contact, or deliberately leave it without one
   * (PAC-91 §7).
   *
   * Scope is settled here — the household is loaded through the same filter as
   * `GET /households/:id`, so one outside the caller's branch reads as 404 —
   * and every rule about *who may lead* it belongs to
   * {@link PrimaryContactService}, which the deceased-contact path in
   * `PATCH /contacts/:id` calls with the same arguments. Two entry points, one
   * set of rules, one activity row.
   *
   * The full `HouseholdView` comes back because the write moves more than the
   * one ref: the roster's `isPrimary`, the resolved `primaryEmail` / `primaryPhone`
   * and the `no_primary` flag all change together, and a caller reconstructing
   * that from `{ ok: true }` would get at least one of them wrong.
   */
  async setPrimaryContact(
    access: AccessContext,
    householdId: string,
    dto: SetPrimaryContactDto,
  ): Promise<HouseholdView> {
    const scope = this.scopeFilter(access);
    if (!Types.ObjectId.isValid(householdId)) {
      throw new NotFoundException('Household not found');
    }

    const household = await this.householdModel
      .findOne({ ...scope, _id: new Types.ObjectId(householdId) })
      .lean();
    if (!household) throw new NotFoundException('Household not found');

    // A malformed contact id is a 404 on the *contact*, not a CastError. The
    // household exists; the person named does not.
    if (dto.contactId && !Types.ObjectId.isValid(dto.contactId)) {
      throw new NotFoundException('Contact not found');
    }

    await this.primaryContacts.assign({
      household,
      contactId: dto.contactId ? new Types.ObjectId(dto.contactId) : null,
      allowNoPrimary: dto.allowNoPrimary,
      actorUserId: Types.ObjectId.isValid(access.userId)
        ? new Types.ObjectId(access.userId)
        : null,
    });

    return this.getHousehold(access, householdId);
  }

  /**
   * End a membership — "remove from household", without deleting the person.
   *
   * Soft (`endedAt`), because the two are different facts: somebody moving out
   * does not un-drive the car they were listed on, and the household's history
   * has to keep rendering them. The contact itself is untouched and keeps every
   * other household they belong to.
   *
   * Refuses to end the **primary contact's** membership: a household whose
   * primary is not a member of it is a state no reader can render sensibly, and
   * the fix is to name a different primary first — a deliberate operation of
   * its own (PAC-91 §7). 409 rather than 400, because the request is
   * well-formed and the obstacle is the record's state.
   */
  async endHouseholdMembership(
    access: AccessContext,
    householdId: string,
    contactId: string,
  ): Promise<{ ended: true }> {
    const scope = this.scopeFilter(access);
    if (
      !Types.ObjectId.isValid(householdId) ||
      !Types.ObjectId.isValid(contactId)
    ) {
      throw new NotFoundException('Household member not found');
    }

    const household = await this.householdModel
      .findOne({ ...scope, _id: new Types.ObjectId(householdId) })
      .select('primaryContactId')
      .lean();
    if (!household) throw new NotFoundException('Household not found');

    const contact = new Types.ObjectId(contactId);
    if (String(household.primaryContactId) === String(contact)) {
      throw new ConflictException(
        'This contact is the household\u2019s primary contact. Assign a ' +
          'different primary contact before removing them.',
      );
    }

    const ended = await this.memberships.end(
      this.agencyIdOf(access),
      new Types.ObjectId(householdId),
      contact,
    );
    if (!ended) throw new NotFoundException('Household member not found');
    return { ended: true };
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

    const [summary] = household
      ? await this.withPrimaryContacts([household], toHouseholdSummary)
      : [null];

    return {
      ...toPolicySummary(policy),
      notes: policy.notes ?? null,
      household: summary,
    };
  }
}

/**
 * @param primary the household's primary contact, already resolved — the
 *   household has stored no copy of its name since PAC-91 §4. `undefined` when
 *   it has no primary contact, which renders as the em dash the stored copy
 *   used to produce for every migrated household.
 */
function toHouseholdSummary(
  household: Household & { _id: unknown },
  primary?: ContactDetails,
): HouseholdSummary {
  return {
    id: String(household._id),
    name: household.name ?? null,
    // Normalized on read as well as on import (PAC-80). The re-import heals this
    // database; this is what keeps a code renderable in one migrated by older
    // code, and what stops `b5qvJ` reaching a badge if one ever reappears.
    status: normalizeHouseholdStatus(household.status) || null,
    primaryContactName: primary?.name ?? null,
    /*
     * Beside the name, not instead of it (PAC-91 §7). The name is how a list
     * row identifies the household and it goes on rendering; what this changes
     * is the `primaryEmail` / `primaryPhone` next to it, which every client
     * must stop offering as a way to reach somebody. A row has no roster to
     * look this up in, so it has to travel on the summary.
     */
    primaryContactDeceasedAt: primary?.deceasedAt ?? null,
    dataQuality: household.dataQuality ?? null,
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

/**
 * Both `isPrimary` and `roleInHousehold` are passed in, because since PAC-91 §5
 * neither is a fact about the person: primacy is `household.primaryContactId`
 * and the role belongs to the membership. A caller with no household in hand
 * has neither to give, and `false` / `null` is the honest answer there rather
 * than a stored flag that meant "primary of *something*".
 */
function toContactSummary(
  contact: Contact & { _id: unknown },
  isPrimary = false,
  role?: string | null,
): ContactSummary {
  return {
    id: String(contact._id),
    firstName: contact.firstName ?? null,
    lastName: contact.lastName ?? null,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    roleInHousehold: normalizeContactRole(role) || null,
    isPrimary,
    dateOfBirth: toIso(contact.dateOfBirth),
    // A calendar date, unlike `dateOfBirth`'s ISO instant above: the client
    // renders it as a plain date and `toDateKey` is what the rest of PAC-91
    // serializes a death with.
    deceasedAt: toDateKey(contact.deceasedAt),
  };
}

function orderPrimaryFirst<T extends { _id: unknown }>(
  contacts: T[],
  primaryId: string | null,
): T[] {
  if (!primaryId) return contacts;
  const primary = contacts.filter((c) => String(c._id) === primaryId);
  return [...primary, ...contacts.filter((c) => String(c._id) !== primaryId)];
}

function toIso(value: Date | undefined | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function toHouseholdListRow(
  household: Household & { _id: unknown; updatedAt?: Date },
  matchedOn: HouseholdMatch | null,
  primary?: ContactDetails,
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
    ...toHouseholdSummary(household, primary),
    householdRef: household.householdRef ?? null,
    primaryEmail: primary?.email ?? null,
    primaryPhone: primary?.phone ?? null,
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
