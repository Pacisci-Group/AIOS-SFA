import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AccessContext,
  UnanchoredPolicyRow,
  UnlinkedContactRow,
  UnlinkedCounts,
  UnlinkedHouseholdRow,
  UnlinkedPolicyRow,
  UnlinkedRecordsResponse,
  normalizeCarrier,
  normalizeHouseholdStatus,
  normalizePolicyStatus,
  normalizePolicyType,
} from '@sfa/shared';
import { Model, PipelineStage, Types } from 'mongoose';
import { resolveHouseholdAddress } from '../common/address/household-address';
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema';
import {
  HouseholdMember,
  HouseholdMemberDocument,
} from '../households/schemas/household-member.schema';
import {
  Household,
  HouseholdDocument,
} from '../households/schemas/household.schema';
import { toDateKey } from '../leads/intake/intake.normalize';
import { Policy, PolicyDocument } from '../policies/schemas/policy.schema';
import {
  ClientScopeFilter,
  clientAgencyId,
  clientScopeFilter,
} from './client-scope';
import { ListUnlinkedDto } from './dto/list-unlinked.dto';

/**
 * The **Unlinked records** work list (PAC-91 §10, extended by PAC-126).
 *
 * ── Why it exists ───────────────────────────────────────────────────────────
 * The Phase 1 CSV backfill repaired every link SmartSuite could prove and
 * reported the rest: 136 policies attributable to no household, ~280 people in
 * no household, 59 households nobody leads (measured on the 2026-09-04
 * production data). David's decision was to leave those unlinked and let the
 * team work them by hand — but nothing in the app *showed* them, so the only
 * way to find an unlinked policy was to stumble on it.
 *
 * This is deliberately the smallest thing that fixes that: four predicates
 * over data that already exists, no new schema, no new writes. Each row opens
 * the record it names so the existing actions can be used; where an action does
 * not exist yet the view's job is to make that gap visible, not to fill it.
 *
 * The fourth — {@link listUnanchoredPolicies} — is PAC-126's, and is a missing
 * *date* rather than a missing *link*. It is filed here because it is the same
 * job for the same people, and because the 2026-09-08 renewal backfill reported
 * exactly this population to a console log nobody reads. See the shared
 * `unlinked-records.ts` docblock for why the page keeps its narrower title.
 *
 * ── Its own service, not another method on `ClientsService` ─────────────────
 * `ClientsService` is the read/write surface for *a* client record. This is a
 * data-quality report over three collections that happen to be filed under the
 * same page, sharing only the scope rule (hence `client-scope.ts`). Folding it
 * in would have added a third set of aggregation helpers to a 1,100-line file
 * whose existing ones are all about one search.
 *
 * ── Indexes ────────────────────────────────────────────────────────────────
 * Every query here rides an index that already exists, which is why neither
 * Phase 5 nor PAC-126 ships a migration:
 * - policies → `{agencyId, householdId}` on `policies`;
 * - unanchored → `{agencyId, active, renewalDate}` on `policies`, the index the
 *   renewal scan added. It serves the `active` + `renewalDate: null` prefix; the
 *   `effectiveDate` / `expirationDate` legs then filter the matched set, which
 *   is small by construction — a book where most policies have no date at all
 *   has a bigger problem than this query;
 * - households → `primaryContactId_1` (non-sparse, so missing values are
 *   indexed as null and `{primaryContactId: null}` is served by it);
 * - both memberships lookups → `{agencyId, householdId, contactId}` and
 *   `{agencyId, contactId}` on `householdMembers`.
 *
 * `Household.dataQuality` is **projected, never predicated** (see
 * {@link listUnlinkedHouseholds}), so it stays unindexed — an index-options
 * change on a live collection is a migrate-mongo migration, and this view does
 * not need one.
 */
@Injectable()
export class UnlinkedRecordsService {
  /**
   * `$lookup` takes a collection name, not a model. Read off the injected model
   * so `@Schema({ collection })` stays the one place the name is written down.
   */
  private readonly membersCollection: string;

  /** Same reason as {@link membersCollection} — see {@link listUnanchoredPolicies}. */
  private readonly householdsCollection: string;

  constructor(
    @InjectModel(Household.name)
    private readonly householdModel: Model<HouseholdDocument>,
    @InjectModel(Policy.name)
    private readonly policyModel: Model<PolicyDocument>,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    @InjectModel(HouseholdMember.name)
    memberModel: Model<HouseholdMemberDocument>,
  ) {
    this.membersCollection = memberModel.collection.name;
    this.householdsCollection = householdModel.collection.name;
  }

  /**
   * The numbers behind the filter chips.
   *
   * Run in parallel: they are independent counts over three collections, and
   * the page shows all of them whichever list is open.
   */
  async counts(access: AccessContext): Promise<UnlinkedCounts> {
    const scope = clientScopeFilter(access);
    const agencyId = clientAgencyId(access);

    const [policies, contacts, households, unanchored] = await Promise.all([
      this.policyModel.countDocuments(unlinkedPolicyFilter(scope)),
      this.countAggregate(
        this.contactModel,
        this.contactPipeline(scope, agencyId),
      ),
      this.householdModel.countDocuments(unlinkedHouseholdFilter(scope)),
      this.policyModel.countDocuments(unanchoredPolicyFilter(scope)),
    ]);

    return { policies, contacts, households, unanchored };
  }

  /** One page of one kind. The `kind` discriminates the response, not just the query. */
  async list(
    access: AccessContext,
    query: ListUnlinkedDto,
  ): Promise<UnlinkedRecordsResponse> {
    switch (query.kind) {
      case 'policies':
        return this.listUnlinkedPolicies(access, query);
      case 'contacts':
        return this.listUnlinkedContacts(access, query);
      case 'households':
        return this.listUnlinkedHouseholds(access, query);
      case 'unanchored':
        return this.listUnanchoredPolicies(access, query);
    }
  }

  /** Policies carrying no `householdId` — the premium nobody can attribute. */
  private async listUnlinkedPolicies(
    access: AccessContext,
    { page, pageSize }: ListUnlinkedDto,
  ): Promise<UnlinkedRecordsResponse> {
    const filter = unlinkedPolicyFilter(clientScopeFilter(access));

    const [total, policies] = await Promise.all([
      this.policyModel.countDocuments(filter),
      this.policyModel
        .find(filter)
        .sort(NEWEST_FIRST)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    return {
      kind: 'policies',
      ...envelope(page, pageSize, total),
      items: policies.map((policy): UnlinkedPolicyRow => ({
        id: String(policy._id),
        policyNumber: policy.policyNumber ?? null,
        policyType: normalizePolicyType(policy.policyType) || null,
        carrier: normalizeCarrier(policy.carrier) || null,
        policyStatus: normalizePolicyStatus(policy.policyStatus) || null,
        active: policy.active ?? false,
        premium: policy.premium ?? 0,
        items: policy.items ?? 0,
        effectiveDate: toIso(policy.effectiveDate),
        createdAt: toIso(policy.createdAt),
      })),
    };
  }

  /**
   * Contacts with no **current** membership anywhere.
   *
   * An anti-join rather than a field test: since PAC-91 §5 the contact carries
   * no household of its own, so "unlinked" is the absence of a `householdMembers`
   * row with `endedAt: null`. Somebody who left every household they were in is
   * therefore listed — correctly, since the book no longer connects them to
   * anything.
   *
   * The `$lookup` runs before the filter can, so it touches every in-scope
   * contact (3,082 on production) rather than one page's worth. It is an
   * indexed lookup capped at one row per contact; if the book ever reaches a
   * size where that matters, the fix is a stored flag maintained by the
   * membership writers, not a bigger pipeline.
   */
  private async listUnlinkedContacts(
    access: AccessContext,
    { page, pageSize }: ListUnlinkedDto,
  ): Promise<UnlinkedRecordsResponse> {
    const pipeline = this.contactPipeline(
      clientScopeFilter(access),
      clientAgencyId(access),
    );

    const [total, contacts] = await Promise.all([
      this.countAggregate(this.contactModel, pipeline),
      this.contactModel
        .aggregate<Contact & { _id: Types.ObjectId; createdAt?: Date }>([
          ...pipeline,
          { $sort: NEWEST_FIRST },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
        ])
        .exec(),
    ]);

    return {
      kind: 'contacts',
      ...envelope(page, pageSize, total),
      items: contacts.map((contact): UnlinkedContactRow => ({
        id: String(contact._id),
        firstName: contact.firstName ?? null,
        lastName: contact.lastName ?? null,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        dateOfBirth: toIso(contact.dateOfBirth),
        // A calendar date, unlike `dateOfBirth`'s instant above — the same
        // split `toContactSummary` makes.
        deceasedAt: toDateKey(contact.deceasedAt),
        createdAt: toIso(contact.createdAt),
      })),
    };
  }

  /**
   * Households with no `primaryContactId` — **one list, not two.**
   *
   * A household reaches this list two ways: nobody ever named a primary (77 on
   * the production data), or somebody deliberately left it without one and it
   * carries `dataQuality: 'no_primary'` (PAC-91 §7 — a death with no
   * successor). Phase 5 is that flag's first and only reader, so how to present
   * the two is a decision this view has to make.
   *
   * They are **one list with the reason on the row**, because:
   * - the predicate is "no primary contact", and both classes satisfy it — a
   *   count that disagreed with the database would undermine the one thing a
   *   data-quality list is for;
   * - `no_primary` is not a resolution. The schema's own note says it "still
   *   needs an answer"; the answer is to add a member and name them, which is
   *   the same job as every other row here, just further along;
   * - it keeps the page at the three chips David asked for.
   *
   * `memberCount` is what separates the two jobs at a glance — pick somebody
   * out of the roster, or add a member first — and it is why the lookup is
   * here at all. It runs **after** `$skip`/`$limit`, so it costs one indexed
   * count per rendered row rather than per household in the agency.
   */
  private async listUnlinkedHouseholds(
    access: AccessContext,
    { page, pageSize }: ListUnlinkedDto,
  ): Promise<UnlinkedRecordsResponse> {
    const agencyId = clientAgencyId(access);
    const filter = unlinkedHouseholdFilter(clientScopeFilter(access));

    const [total, households] = await Promise.all([
      this.householdModel.countDocuments(filter),
      this.householdModel
        .aggregate<
          Household & { _id: Types.ObjectId; createdAt?: Date; members: number }
        >([
          { $match: filter },
          { $sort: NEWEST_FIRST },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          {
            $lookup: {
              from: this.membersCollection,
              let: { householdId: '$_id' },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ['$householdId', '$$householdId'] },
                    agencyId,
                    // `endedAt: null` also matches an absent field — see
                    // `HouseholdMemberSchema`'s "soft end, not delete" note.
                    endedAt: null,
                  },
                },
                { $count: 'total' },
              ],
              as: 'memberCount',
            },
          },
          {
            $set: {
              members: {
                $ifNull: [{ $arrayElemAt: ['$memberCount.total', 0] }, 0],
              },
            },
          },
          { $unset: 'memberCount' },
        ])
        .exec(),
    ]);

    return {
      kind: 'households',
      ...envelope(page, pageSize, total),
      items: households.map((household): UnlinkedHouseholdRow => {
        // Coerced here rather than in the client, for the reason
        // `toHouseholdListRow` spells out: property first, then mailing.
        const address = resolveHouseholdAddress(
          null,
          household.propertyAddress,
          household.mailingAddress,
        );
        return {
          id: String(household._id),
          householdRef: household.householdRef ?? null,
          name: household.name ?? null,
          status: normalizeHouseholdStatus(household.status) || null,
          city: address?.city || null,
          state: address?.state || null,
          totalActivePolicies: household.totalActivePolicies ?? 0,
          memberCount: household.members ?? 0,
          dataQuality: household.dataQuality ?? null,
          createdAt: toIso(household.createdAt),
        };
      }),
    };
  }

  /**
   * Active policies with **no renewal anchor at all** (PAC-126).
   *
   * `renewalDate` is what every renewal call counts backwards from. The scan's
   * fallback chain is `renewalDate ?? effectiveDate ?? expirationDate`; when all
   * three are empty there is nothing to derive a term from, `nextRenewalDate`
   * returns null, and the policy is skipped on every pass forever. The 2026-09-08
   * backfill counted these and deliberately refused to invent a date — "a policy
   * with neither anchor is left alone and reported rather than given a guessed
   * date that would call real clients". This list *is* that report.
   *
   * ## Why the predicate is not the backfill's
   *
   * The migration's rule was `effectiveDate ?? deal.soldDate`, which would pull
   * in the deal collection and — worse — disagree with the runtime. A row must
   * disappear from this list exactly when the scan starts seeing it, so the
   * predicate mirrors `rollForwardRenewalDates`'s chain and nothing else.
   *
   * ## Why `active: true`
   *
   * An inactive policy gets no outreach, so a missing anchor on one is not work.
   * It also keeps the count honest as a queue: it is the number of live policies
   * the renewal desk currently cannot see.
   *
   * The household rides along because it is the only actionable thing on the row
   * — every date is null by construction. It is looked up **after** `$skip`/
   * `$limit`, one indexed `_id` hit per rendered row, the same way
   * {@link listUnlinkedHouseholds} counts members.
   */
  private async listUnanchoredPolicies(
    access: AccessContext,
    { page, pageSize }: ListUnlinkedDto,
  ): Promise<UnlinkedRecordsResponse> {
    const filter = unanchoredPolicyFilter(clientScopeFilter(access));

    const [total, policies] = await Promise.all([
      this.policyModel.countDocuments(filter),
      this.policyModel
        .aggregate<
          Policy & {
            _id: Types.ObjectId;
            createdAt?: Date;
            household: { householdRef?: string; name?: string }[];
          }
        >([
          { $match: filter },
          { $sort: NEWEST_FIRST },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          {
            $lookup: {
              from: this.householdsCollection,
              let: { householdId: '$householdId' },
              pipeline: [
                // A null `householdId` matches nothing and yields `[]` — a
                // policy can legitimately be unattributed *and* undated, and so
                // appear in this list and the `policies` one at once.
                { $match: { $expr: { $eq: ['$_id', '$$householdId'] } } },
                { $limit: 1 },
                { $project: { householdRef: 1, name: 1 } },
              ],
              as: 'household',
            },
          },
        ])
        .exec(),
    ]);

    return {
      kind: 'unanchored',
      ...envelope(page, pageSize, total),
      items: policies.map((policy): UnanchoredPolicyRow => {
        const household = policy.household?.[0];
        return {
          id: String(policy._id),
          policyNumber: policy.policyNumber ?? null,
          policyType: normalizePolicyType(policy.policyType) || null,
          carrier: normalizeCarrier(policy.carrier) || null,
          policyStatus: normalizePolicyStatus(policy.policyStatus) || null,
          premium: policy.premium ?? 0,
          items: policy.items ?? 0,
          householdId: policy.householdId ? String(policy.householdId) : null,
          householdRef: household?.householdRef ?? null,
          householdName: household?.name ?? null,
          createdAt: toIso(policy.createdAt),
        };
      }),
    };
  }

  /**
   * The anti-join, shared by the contacts list and its count so the number on
   * the chip and the rows behind it can never disagree.
   */
  private contactPipeline(
    scope: ClientScopeFilter,
    agencyId: string,
  ): PipelineStage[] {
    return [
      { $match: { ...scope, ...NOT_A_TEST_RECORD } },
      {
        $lookup: {
          from: this.membersCollection,
          let: { contactId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$contactId', '$$contactId'] },
                agencyId,
                endedAt: null,
              },
            },
            // One row is enough to disqualify a contact; the count is irrelevant.
            { $limit: 1 },
            { $project: { _id: 1 } },
          ],
          as: 'memberships',
        },
      },
      { $match: { memberships: { $size: 0 } } },
      { $unset: 'memberships' },
    ];
  }

  /** `$count` returns no document at all for an empty match, hence the `?? 0`. */
  private async countAggregate(
    model: Model<ContactDocument>,
    pipeline: PipelineStage[],
  ): Promise<number> {
    const [row] = await model
      .aggregate<{ total: number }>([...pipeline, { $count: 'total' }])
      .exec();
    return row?.total ?? 0;
  }
}

/**
 * Newest first, with `_id` as the tiebreaker so pages do not shuffle between
 * requests.
 *
 * ⚠ Every migrated record shares one `createdAt` — the moment the import ran —
 * so on production data this orders by insertion within that batch and puts
 * anything created in the app since go-live at the top. That is the useful
 * answer: a record the app created without a link is a live defect, while the
 * migrated backlog is the known one.
 */
const NEWEST_FIRST = { createdAt: -1, _id: -1 } as const;

/**
 * Excluded from every kind (David, 2026-09-07): the Sample/Test rows the
 * agency's SmartSuite book carries. `$ne: true` rather than `false`, because a
 * record written before the field existed simply has no `isTestRecord` at all.
 */
const NOT_A_TEST_RECORD = { isTestRecord: { $ne: true } } as const;

function unlinkedPolicyFilter(scope: ClientScopeFilter) {
  // `null` matches both a stored null and an absent field — migrated policies
  // that never had a household carry neither.
  return { ...scope, ...NOT_A_TEST_RECORD, householdId: null };
}

function unlinkedHouseholdFilter(scope: ClientScopeFilter) {
  return { ...scope, ...NOT_A_TEST_RECORD, primaryContactId: null };
}

/**
 * An active policy the renewal scan can never schedule (PAC-126).
 *
 * All three legs of the runtime fallback chain empty — see
 * {@link UnlinkedRecordsService.listUnanchoredPolicies} for why it is this chain
 * and not the backfill's. `null` matches an absent field too, which is the usual
 * case: a migrated policy that never carried a date has no key at all.
 */
function unanchoredPolicyFilter(scope: ClientScopeFilter) {
  return {
    ...scope,
    ...NOT_A_TEST_RECORD,
    active: true,
    renewalDate: null,
    effectiveDate: null,
    expirationDate: null,
  };
}

function envelope(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function toIso(value: Date | undefined | null): string | null {
  return value ? new Date(value).toISOString() : null;
}
