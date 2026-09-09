import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import type { CreatedRegistry } from '../common/mongo/transaction.runner';
import {
  HouseholdMember,
  HouseholdMemberDocument,
  HouseholdMemberSource,
} from './schemas/household-member.schema';

/** An ObjectId, a lean `_id`, or an already-serialized id string. */
type IdLike = { toString(): string };

/** One current membership, as every reader here needs it. */
export interface Membership {
  householdId: Types.ObjectId;
  contactId: Types.ObjectId;
  role?: string | null;
  addedAt?: Date;
}

export interface AddMembershipInput {
  agencyId: string;
  branchId: string;
  householdId: Types.ObjectId;
  contactId: Types.ObjectId;
  /** Left alone on an existing membership — see {@link HouseholdMembersService.add}. */
  role?: string | null;
  source: HouseholdMemberSource;
  addedAt?: Date;
}

/** Optional session + created-registry, for callers inside the intake pipeline. */
export interface MembershipWriteOptions {
  session?: ClientSession | null;
  created?: CreatedRegistry;
}

function sessionOption(session?: ClientSession | null): {
  session?: ClientSession;
} {
  return session ? { session } : {};
}

/**
 * Reads and writes over the `householdMembers` join collection (PAC-91 §5).
 *
 * One service rather than a query in each feature, because every caller has to
 * agree on two things that are easy to get subtly wrong:
 *
 * - **"Current" means `endedAt: null`.** In MongoDB that predicate also matches
 *   documents where the field is absent, which is what lets a row written by
 *   the seed migration read as current without being backfilled. A reader that
 *   forgets the filter would list people who have left.
 * - **Adding is an upsert, never an insert.** Linking is idempotent by
 *   construction: a repeated intake submission, a re-run migration and a
 *   re-added member all converge on the one row the unique index allows.
 *
 * Tenancy is a **string** `agencyId` on every query — `TenantRecord`, not
 * `User`. An ObjectId here matches nothing at all, which reads as an empty
 * household.
 */
@Injectable()
export class HouseholdMembersService {
  constructor(
    @InjectModel(HouseholdMember.name)
    private readonly memberModel: Model<HouseholdMemberDocument>,
  ) {}

  /**
   * Add a contact to a household, or revive the membership if they left.
   *
   * **Adds, never moves** (PAC-91 §5). The single `Contact.householdId` this
   * replaces was `$set` on every link, so joining a second household silently
   * dropped the first while that household went on listing the contact. There
   * is no counterpart here: nothing is removed, and belonging to three
   * households is three rows.
   *
   * `role` is written **only when the membership is new**. A returning intake
   * form must not demote a Named Insured to "Child" — the same rule
   * `ResolveContactStep` applies to the contact's own fields, for the same
   * reason: a form is a weak source of truth about a household somebody already
   * curated.
   *
   * @returns true when a row was inserted (as opposed to an existing one being
   *   revived or left alone) — the count the seeds and the importer report.
   */
  async add(
    input: AddMembershipInput,
    options: MembershipWriteOptions = {},
  ): Promise<boolean> {
    const now = new Date();
    const result = await this.memberModel.updateOne(
      {
        agencyId: input.agencyId,
        householdId: input.householdId,
        contactId: input.contactId,
      },
      {
        // Clearing `endedAt` on every add is what makes "re-add somebody who
        // left" work without a second row, and is a no-op for a current one.
        $set: { endedAt: null },
        $setOnInsert: {
          branchId: input.branchId,
          addedAt: input.addedAt ?? now,
          ...(input.role ? { role: input.role } : {}),
          source: input.source,
        },
      },
      { upsert: true, ...sessionOption(options.session) },
    );

    if (result.upsertedId && options.created) {
      options.created.track(this.memberModel, result.upsertedId);
    }
    return Boolean(result.upsertedId);
  }

  /**
   * End a membership — the contact stays, the household stays, the link stops.
   *
   * Soft, so the household's history survives: "was a driver here until March"
   * is a fact a service rep needs, and a `$pull` from the old array left nothing
   * behind at all.
   *
   * @returns false when there was no current membership to end, so the caller
   *   can 404 rather than reporting a no-op as a success.
   */
  async end(
    agencyId: string,
    householdId: Types.ObjectId,
    contactId: Types.ObjectId,
    options: MembershipWriteOptions = {},
  ): Promise<boolean> {
    const result = await this.memberModel.updateOne(
      { agencyId, householdId, contactId, endedAt: null },
      { $set: { endedAt: new Date() } },
      sessionOption(options.session),
    );
    return result.modifiedCount > 0;
  }

  /** The household's current roster, in no particular order. */
  async listByHousehold(
    agencyId: string,
    householdId: Types.ObjectId,
    options: MembershipWriteOptions = {},
  ): Promise<Membership[]> {
    return this.find({ agencyId, householdId }, options.session);
  }

  /**
   * Every household this contact currently belongs to.
   *
   * The replacement for reading `contact.householdId`, and the reason the
   * `{ agencyId, contactId }` index exists. Returns *all* of them: a caller
   * that needs exactly one has to say what it does with several, which is the
   * whole point of the many-to-many change.
   */
  async listByContact(
    agencyId: string,
    contactId: Types.ObjectId,
    options: MembershipWriteOptions = {},
  ): Promise<Membership[]> {
    return this.find({ agencyId, contactId }, options.session);
  }

  /**
   * Current memberships for several households at once, keyed by household id.
   *
   * Batched for the same reason `loadContactDetails` is: the callers are list
   * builders, and one query per row is how a page that ran two queries starts
   * running fifty.
   */
  async mapByHouseholds(
    agencyId: string,
    householdIds: ReadonlyArray<IdLike>,
  ): Promise<Map<string, Membership[]>> {
    const out = new Map<string, Membership[]>();
    const ids = [...new Set(householdIds.map((id) => String(id)))];
    if (!ids.length) return out;

    const rows = await this.find({
      agencyId,
      householdId: { $in: ids.map((id) => new Types.ObjectId(id)) },
    });
    for (const row of rows) {
      const key = String(row.householdId);
      const bucket = out.get(key);
      if (bucket) bucket.push(row);
      else out.set(key, [row]);
    }
    return out;
  }

  /**
   * Current memberships for several contacts at once, keyed by contact id.
   *
   * The contact→household direction of {@link mapByHouseholds}, for the Clients
   * search: one contact can now match several households, so the map's values
   * are lists.
   */
  async mapByContacts(
    agencyId: string,
    contactIds: ReadonlyArray<IdLike>,
  ): Promise<Map<string, Membership[]>> {
    const out = new Map<string, Membership[]>();
    const ids = [...new Set(contactIds.map((id) => String(id)))];
    if (!ids.length) return out;

    const rows = await this.find({
      agencyId,
      contactId: { $in: ids.map((id) => new Types.ObjectId(id)) },
    });
    for (const row of rows) {
      const key = String(row.contactId);
      const bucket = out.get(key);
      if (bucket) bucket.push(row);
      else out.set(key, [row]);
    }
    return out;
  }

  /** Every current-membership query in one place, so none of them can forget `endedAt`. */
  private async find(
    filter: Record<string, unknown>,
    session?: ClientSession | null,
  ): Promise<Membership[]> {
    const query = this.memberModel
      .find({ ...filter, endedAt: null })
      .select('householdId contactId role addedAt');
    if (session) query.session(session);
    return query.lean<Membership[]>();
  }
}

/** Role by contact id, for a roster that has its memberships in hand. */
export function rolesByContact(
  memberships: ReadonlyArray<Membership>,
): Map<string, string | null> {
  return new Map(
    memberships.map((membership) => [
      String(membership.contactId),
      membership.role ?? null,
    ]),
  );
}
