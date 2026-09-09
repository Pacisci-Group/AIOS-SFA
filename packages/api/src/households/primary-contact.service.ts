import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  CONTACT_DECEASED_CODE,
  CONTACT_NOT_A_MEMBER_CODE,
  PRIMARY_ELSEWHERE_CODE,
  SUCCESSION_REQUIRED_CODE,
  normalizeContactRole,
  type SuccessorCandidate,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  Activity,
  ActivityDocument,
} from '../activities/schemas/activity.schema';
import { contactDisplayName } from '../contacts/contact-details';
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema';
import { HouseholdMembersService } from './household-members.service';
import { Household, HouseholdDocument } from './schemas/household.schema';

/** The `no_primary` flag, as it is stored. */
const NO_PRIMARY = 'no_primary';

/** The household fields this service needs in hand. Lean or hydrated both fit. */
export interface HouseholdRef {
  _id: Types.ObjectId;
  agencyId: string;
  branchId?: string | null;
  householdRef?: string | null;
  name?: string | null;
  primaryContactId?: Types.ObjectId | null;
  dataQuality?: string | null;
}

export interface AssignPrimaryContactInput {
  household: HouseholdRef;
  /** The new primary, or `null` together with `allowNoPrimary`. */
  contactId: Types.ObjectId | null;
  /** Required to clear the primary. Ignored when `contactId` is given. */
  allowNoPrimary?: boolean;
  /** Whoever performed it — the row's author, not its subject. */
  actorUserId?: Types.ObjectId | null;
  /**
   * Why, for the activity summary. `succession` when a death forced it, so the
   * timeline can tell "we corrected a mistake" from "somebody died".
   */
  reason?: 'assigned' | 'succession';
}

/**
 * The reassign-primary-contact operation (PAC-91 §7).
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 * `Household.primaryContactId` was only ever *filled* — `LinkEntitiesStep` sets
 * it on create, or when it is currently unset, and deliberately never
 * reassigns, so a second lead could not steal the primary. The consequence was
 * that **there was no supported way to change a household's primary contact,
 * for any reason**: not a death, not a divorce, not a wrong primary picked at
 * intake. This is that operation, and the death flow calls it rather than the
 * other way round — succession is one reason among several, not a special case.
 *
 * ── The three rules, and why each is checked here ───────────────────────────
 * 1. **A current member.** A household whose primary is not a member of it is a
 *    state no reader can render sensibly — the roster comes from
 *    `householdMembers` and the primary is picked out of it by id, so a
 *    non-member primary simply disappears from the page that names them.
 * 2. **Not deceased.** The whole of §7 is that a dead person stops being the
 *    forward-looking answer to anything; promoting one would be the exact bug
 *    the ticket describes, from the other end.
 * 3. **Not already primary elsewhere.** The owner's rule (David, 2026-09-04) is
 *    one primacy per contact, and the partial unique index on
 *    `{ agencyId, primaryContactId }` enforces it. Checked in application code
 *    *first* so the 409 can name the other household; the index is the backstop
 *    for the race, and an E11000 is mapped onto the same response so the caller
 *    cannot tell which one fired.
 *
 *    ⚠ On a database where that index has not been built yet — Phase 3's
 *    migration refuses over pre-existing double primaries — this pre-check is
 *    the *only* enforcement. That is the reason it is a real query rather than a
 *    reliance on the write failing.
 *
 * ── Clearing is an answer, and has to be said out loud ──────────────────────
 * `contactId: null` with `allowNoPrimary` records "this household deliberately
 * has no primary contact" and flags it `no_primary`. It is the (c) fallback in
 * §7's decision — required successor, else a flagged gap — and it is also the
 * only honest outcome when the household's one member is the person who died.
 * It is never the default: a body that cleared the ref by accident is the one
 * mistake a household record cannot survive quietly.
 */
@Injectable()
export class PrimaryContactService {
  private readonly logger = new Logger(PrimaryContactService.name);

  constructor(
    @InjectModel(Household.name)
    private readonly householdModel: Model<HouseholdDocument>,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    @InjectModel(Activity.name)
    private readonly activityModel: Model<ActivityDocument>,
    private readonly memberships: HouseholdMembersService,
  ) {}

  /**
   * The one household this contact is the primary of, or null.
   *
   * Singular by the owner's rule, and by the index that enforces it. Used by
   * `PATCH /contacts/:id` to discover whether marking somebody deceased leaves a
   * household leaderless — the question that has to be answered in the *same*
   * request.
   */
  async householdLedBy(
    agencyId: string,
    contactId: Types.ObjectId,
  ): Promise<HouseholdDocument | null> {
    return this.householdModel
      .findOne({ agencyId, primaryContactId: contactId })
      .lean<HouseholdDocument | null>();
  }

  /**
   * Who could take over this household — current members, alive, and not
   * already leading another household.
   *
   * Deliberately **not ranked**. Auto-promotion by role precedence (Spouse →
   * adult member → …) was the (b) option in §7 and it is a guess at something
   * the producer knows, made on the record every policy in the family hangs
   * off. This offers; the human chooses.
   *
   * An empty list is a legitimate answer, not a failure: a household whose only
   * member has died has nobody to promote, and the caller's next step is
   * `allowNoPrimary`.
   */
  async listSuccessors(
    agencyId: string,
    householdId: Types.ObjectId,
    excludeContactId?: Types.ObjectId | null,
  ): Promise<SuccessorCandidate[]> {
    const memberships = await this.memberships.listByHousehold(
      agencyId,
      householdId,
    );
    const excluded = excludeContactId ? String(excludeContactId) : null;
    const candidateIds = memberships
      .filter((membership) => String(membership.contactId) !== excluded)
      .map((membership) => membership.contactId);
    if (!candidateIds.length) return [];

    const contacts = await this.contactModel
      .find({
        agencyId,
        _id: { $in: candidateIds },
        // `null` also matches an absent field, which is every contact who has
        // not died — the same predicate `endedAt: null` relies on.
        deceasedAt: null,
      })
      .select('firstName lastName')
      .lean();

    // One query for "already leads somewhere else", not one per candidate.
    const ledElsewhere = await this.householdModel
      .find({
        agencyId,
        primaryContactId: { $in: contacts.map((contact) => contact._id) },
        _id: { $ne: householdId },
      })
      .select('primaryContactId')
      .lean();
    const taken = new Set(
      ledElsewhere.map((household) => String(household.primaryContactId)),
    );

    const roleByContact = new Map(
      memberships.map((membership) => [
        String(membership.contactId),
        membership.role ?? null,
      ]),
    );

    return contacts
      .filter((contact) => !taken.has(String(contact._id)))
      .map((contact) => ({
        id: String(contact._id),
        name: contactDisplayName(contact) ?? 'Unnamed contact',
        // Normalised on read, like every other role we render: 1,022 migrated
        // contacts stored a raw SmartSuite choice code (PAC-80).
        role:
          normalizeContactRole(roleByContact.get(String(contact._id))) || null,
      }));
  }

  /**
   * Name a household's primary contact, or deliberately leave it without one.
   *
   * The household is expected to be **already scope-checked** by the caller —
   * both entry points load it through their own tenancy filter, and a service
   * that re-derived scope from an `AccessContext` would be a second place for
   * that decision to live.
   *
   * @returns the contact now leading the household, or null when it was cleared.
   */
  async assign(
    input: AssignPrimaryContactInput,
  ): Promise<Types.ObjectId | null> {
    const { household } = input;
    const previous = household.primaryContactId ?? null;

    if (!input.contactId) {
      if (!input.allowNoPrimary) {
        // Defensive: both DTOs refuse this shape, so reaching here is a
        // programming error rather than a bad request.
        throw new ConflictException(
          'Clearing a household’s primary contact has to be explicit.',
        );
      }
      /*
       * Already cleared and already flagged — nothing to say.
       *
       * Without this, re-sending the same request appends another
       * `primary_contact_changed` row reading `null → null`. The local
       * rehearsal on the production dump caught exactly that: replaying every
       * resolution left the data identical and the timeline one row longer,
       * which is the shape of history that makes an audit trail useless.
       */
      if (!previous && household.dataQuality === NO_PRIMARY) return null;

      await this.householdModel.updateOne(
        { _id: household._id },
        { $unset: { primaryContactId: '' }, $set: { dataQuality: NO_PRIMARY } },
      );
      await this.recordChange(input, previous, null);
      return null;
    }

    const contact = await this.requireAssignableContact(
      household,
      input.contactId,
    );

    // No-op rather than a redundant write plus a misleading timeline row.
    if (previous && String(previous) === String(contact._id)) {
      if (household.dataQuality === NO_PRIMARY) {
        await this.householdModel.updateOne(
          { _id: household._id },
          { $unset: { dataQuality: '' } },
        );
      }
      return contact._id;
    }

    try {
      await this.householdModel.updateOne(
        { _id: household._id },
        {
          $set: { primaryContactId: contact._id },
          // Assigning a primary answers the question the flag was raised about.
          $unset: { dataQuality: '' },
        },
      );
    } catch (error: unknown) {
      // The index winning a race the pre-check lost. Same 409 either way, so
      // the caller never has to know which enforcement fired.
      if (isDuplicateKeyError(error)) {
        throw primaryElsewhere(contact._id.toString(), null);
      }
      throw error;
    }

    await this.recordChange(input, previous, contact._id);
    return contact._id;
  }

  /** Rules 1–3 above, in the order that produces the most useful message. */
  private async requireAssignableContact(
    household: HouseholdRef,
    contactId: Types.ObjectId,
  ): Promise<ContactDocument> {
    const contact = await this.contactModel
      .findOne({ agencyId: household.agencyId, _id: contactId })
      .select('firstName lastName deceasedAt')
      .lean<ContactDocument | null>();
    if (!contact) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: CONTACT_NOT_A_MEMBER_CODE,
        message: 'That contact is not in this agency.',
        contactId: contactId.toString(),
        householdId: household._id.toString(),
      });
    }

    const name = contactDisplayName(contact) ?? 'That contact';

    const memberships = await this.memberships.listByContact(
      household.agencyId,
      contactId,
    );
    const isMember = memberships.some(
      (membership) => String(membership.householdId) === String(household._id),
    );
    if (!isMember) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: CONTACT_NOT_A_MEMBER_CODE,
        message: `${name} is not a member of this household. Add them to it first.`,
        contactId: contactId.toString(),
        householdId: household._id.toString(),
      });
    }

    if (contact.deceasedAt) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: CONTACT_DECEASED_CODE,
        message: `${name} is recorded as deceased and cannot lead a household.`,
        contactId: contactId.toString(),
        householdId: household._id.toString(),
      });
    }

    const elsewhere = await this.householdModel
      .findOne({
        agencyId: household.agencyId,
        primaryContactId: contactId,
        _id: { $ne: household._id },
      })
      .select('householdRef name')
      .lean();
    if (elsewhere) {
      throw primaryElsewhere(contactId.toString(), {
        id: String(elsewhere._id),
        reference: elsewhere.householdRef ?? null,
        name: elsewhere.name ?? null,
      });
    }

    return contact;
  }

  /**
   * The `primary_contact_changed` row — the only provenance this operation
   * leaves (PAC-91 §7).
   *
   * Best-effort and post-write, on the same precedent as `lead_created` and
   * `contact_conflict`: the household is already saved, and a failed timeline
   * write must not report the reassignment as failed.
   *
   * Both names go in `changes`, not in `summary`, for the reason `summary`'s
   * docblock gives: it is the one field that escapes the change-log permission
   * gate. Unlike `lead_reassigned` — which puts its names in `summary`
   * precisely so the producer who lost the lead can see them — nothing renders
   * a household timeline yet, so the conservative placement costs nothing.
   */
  private async recordChange(
    input: AssignPrimaryContactInput,
    from: Types.ObjectId | null,
    to: Types.ObjectId | null,
  ): Promise<void> {
    try {
      const names = await this.contactModel
        .find({ _id: { $in: [from, to].filter(Boolean) } })
        .select('firstName lastName')
        .lean();
      const nameOf = (id: Types.ObjectId | null): string | null => {
        if (!id) return null;
        const match = names.find(
          (contact) => String(contact._id) === String(id),
        );
        return match ? contactDisplayName(match) : null;
      };

      await this.activityModel.create({
        agencyId: input.household.agencyId,
        branchId: input.household.branchId ?? null,
        type: 'primary_contact_changed',
        subjectType: 'household',
        householdId: input.household._id,
        userId: input.actorUserId ?? undefined,
        occurredAt: new Date(),
        summary:
          input.reason === 'succession'
            ? 'Primary contact reassigned after a death'
            : to
              ? 'Primary contact changed'
              : 'Primary contact cleared',
        changes: [
          {
            field: 'primaryContactId',
            label: 'Primary contact',
            kind: 'text',
            from: nameOf(from),
            to: nameOf(to),
          },
        ],
        source: 'app',
        isTestRecord: false,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to record primary_contact_changed for household ${input.household._id.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/** The 409 both the pre-check and the E11000 backstop produce. */
function primaryElsewhere(
  contactId: string,
  household: {
    id: string;
    reference: string | null;
    name: string | null;
  } | null,
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: PRIMARY_ELSEWHERE_CODE,
    message: household
      ? `That contact is already the primary contact of ${
          household.reference ?? household.name ?? 'another household'
        }. A contact can lead only one household.`
      : 'That contact is already the primary contact of another household.',
    contactId,
    household,
  });
}

/**
 * The succession 409 — thrown by `PATCH /contacts/:id`, built here so the
 * candidate list and the message stay with the rules that produce them.
 */
export function successionRequired(
  contactId: string,
  household: {
    _id: Types.ObjectId;
    householdRef?: string | null;
    name?: string | null;
  },
  candidates: SuccessorCandidate[],
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: SUCCESSION_REQUIRED_CODE,
    message: candidates.length
      ? 'This contact is the primary contact of a household. Name who takes ' +
        'over, or confirm the household should be left without a primary contact.'
      : 'This contact is the primary contact of a household with no other ' +
        'living member. Confirm the household should be left without a primary ' +
        'contact.',
    contactId,
    householdId: household._id.toString(),
    householdRef: household.householdRef ?? null,
    householdName: household.name ?? null,
    candidates,
  });
}

/** Mongo's duplicate-key error, however the driver hands it over. */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}
