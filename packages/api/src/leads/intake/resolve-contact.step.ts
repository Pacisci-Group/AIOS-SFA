import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ContactIdentityService } from '../../contacts/contact-identity.service';
import {
  Contact,
  ContactDocument,
} from '../../contacts/schemas/contact.schema';
import { HouseholdMembersService } from '../../households/household-members.service';
import { pickBestContact } from './contact-match';
import {
  normalizeEmail,
  normalizeName,
  normalizePhone,
  parseDateOfBirth,
  phonesMatch,
} from './intake.normalize';
import {
  ContactFieldConflict,
  IntakePerson,
  NAME_COLLATION,
  ResolvedContact,
  sessionOptions,
  StepDeps,
} from './intake.types';

/**
 * Cap on name-collision candidates. Generous — the query is index-backed and
 * "50 people with the same first *and* last name in one agency" is already
 * pathological. Legacy capped at 20 with no ordering, so on a common name the
 * right person could simply not be in the window.
 */
const CANDIDATE_LIMIT = 50;

/** The stored fields the merge below compares against. */
type MatchedContact = Pick<
  ContactDocument,
  '_id' | 'email' | 'phone' | 'dateOfBirth'
>;

/** Step 1 — person-first contact resolution. */
@Injectable()
export class ResolveContactStep {
  constructor(
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    private readonly identity: ContactIdentityService,
    private readonly memberships: HouseholdMembersService,
  ) {}

  /**
   * @param householdId When the intake is pinned to a household, the *fuzzy*
   *   matching below is confined to the contacts **who are members of it**
   *   (PAC-91 §5). The household is a fact here, not something to infer, so an
   *   agency-wide name hit is a weaker signal than a name hit inside the
   *   household the caller is looking at.
   *
   *   The filter used to be `{ householdId }` on the contact — one link per
   *   person — which missed any member whose stored household happened to be a
   *   *different* one of theirs, and so created a duplicate of somebody already
   *   in the room. Reading the membership is the same intent without that hole,
   *   and it is no longer a workaround for the "linking moves the contact" bug
   *   that made confinement necessary: linking adds a membership now, so an
   *   agency-wide hit could no longer drag a stranger out of their household
   *   even if it were allowed.
   *
   *   The full-key identity check that runs *first* is deliberately **not**
   *   confined: under the owner's rule (PAC-91 §9) a name + DOB + phone-or-email
   *   hit is the same person wherever they are filed, and the household filter
   *   is precisely what used to create a second copy of a member who already
   *   existed under another household.
   */
  async run(
    person: IntakePerson,
    deps: StepDeps,
    householdId?: Types.ObjectId,
  ): Promise<ResolvedContact> {
    const firstName = normalizeName(person.firstName);
    const lastName = normalizeName(person.lastName);
    const email = normalizeEmail(person.email);
    const phone = normalizePhone(person.phone);
    const dateOfBirth = parseDateOfBirth(person.dateOfBirth);

    /*
     * The definite answer first (PAC-91 §9). A full-key hit — same name, same
     * date of birth, and the same phone or the same email — is the same person
     * by the owner's rule, so there is nothing for the scorer to weigh. Only
     * the cases the rule cannot decide reach it, and its bias toward "create a
     * new contact" stays right for those: a missing DOB still cannot prove
     * identity either way.
     */
    const definite = await this.identity.findDuplicate(
      deps.ctx.agencyId,
      { firstName, lastName, dateOfBirth, email, phone },
      { session: deps.session },
    );
    if (definite) {
      return this.resolveExisting(
        definite,
        { email, phone, dateOfBirth },
        deps,
      );
    }

    const memberIds = householdId
      ? await this.memberContactIds(householdId, deps)
      : null;
    // An empty roster confines the search to nothing, which is correct: a
    // household with no members has nobody for this person to already be.
    // `.collation(...)` MUST match the index declared on ContactSchema — drop it
    // and the match silently becomes case-sensitive AND scans the collection.
    const candidates = await this.contactModel
      .find({
        agencyId: deps.ctx.agencyId,
        firstName,
        lastName,
        isTestRecord: { $ne: true },
        ...(memberIds ? { _id: { $in: memberIds } } : {}),
      })
      .collation(NAME_COLLATION)
      .limit(CANDIDATE_LIMIT)
      .session(deps.session)
      .lean();

    const matched = pickBestContact(candidates, { dateOfBirth, email, phone });

    if (matched) {
      return this.resolveExisting(matched, { email, phone, dateOfBirth }, deps);
    }

    const [created] = await this.contactModel.create(
      [
        {
          agencyId: deps.ctx.agencyId,
          branchId: deps.ctx.branchId,
          firstName,
          lastName,
          // One value each, normalised (PAC-91 §1). `undefined` rather than
          // `null` for a blank: the partial identity indexes require
          // `$type: 'string'`, and a stored null would be a fourth thing the
          // filter has to reason about.
          email: email ?? undefined,
          phone: phone ?? undefined,
          dateOfBirth: dateOfBirth ?? undefined,
          /*
           * No `isPrimary` / `roleInHousehold` (PAC-91 §5). Both were facts
           * about a *membership*, not about the person: legacy stamped
           * `isPrimary: true` on every contact it created, including household
           * members, because members went through the same function with no
           * role parameter. `LinkEntitiesStep` writes the role onto the
           * membership, and primacy stays `Household.primaryContactId`.
           */
          isTestRecord: false,
        },
      ],
      sessionOptions(deps.session),
    );

    deps.created.track(this.contactModel, created._id);
    return { contactId: created._id, isNew: true };
  }

  /** The contact ids of a household's current members. */
  private async memberContactIds(
    householdId: Types.ObjectId,
    deps: StepDeps,
  ): Promise<Types.ObjectId[]> {
    const memberships = await this.memberships.listByHousehold(
      deps.ctx.agencyId,
      householdId,
      { session: deps.session },
    );
    return memberships.map((membership) => membership.contactId);
  }

  /** Shared tail for both ways of landing on an existing contact. */
  private async resolveExisting(
    matched: MatchedContact,
    values: {
      email: string | null;
      phone: string | null;
      dateOfBirth: Date | null;
    },
    deps: StepDeps,
  ): Promise<ResolvedContact> {
    const conflicts = await this.mergeIntoExisting(matched, values, deps);
    return {
      contactId: matched._id,
      isNew: false,
      ...(conflicts.length ? { conflicts } : {}),
    };
  }

  /**
   * Fill-if-empty merge onto a matched contact (PAC-91 §1).
   *
   * Never destructive and, since PAC-91, never *additive* either: a lead form is
   * a weak source of truth about an existing client, so it may fill a blank
   * email, phone or date of birth, but a value that disagrees with the stored
   * one is reported rather than written. It used to `$addToSet` the new value as
   * a second array element, which meant ordinary app usage grew the very arrays
   * this ticket removes — and left two emails with nothing saying which was
   * current.
   *
   * The membership's `role` is still never touched either: a form must not
   * demote a Named Insured to "Child" (see `HouseholdMembersService.add`).
   *
   * @returns the disagreements, for the caller to put on the lead's timeline.
   */
  private async mergeIntoExisting(
    matched: MatchedContact,
    values: {
      email: string | null;
      phone: string | null;
      dateOfBirth: Date | null;
    },
    deps: StepDeps,
  ): Promise<ContactFieldConflict[]> {
    const set: Record<string, unknown> = {};
    const conflicts: ContactFieldConflict[] = [];

    // Compare normalised-to-normalised: the stored value is already normalised,
    // but a row written before that was true would otherwise read as a conflict
    // with itself.
    if (values.email) {
      const stored = normalizeEmail(matched.email);
      if (!stored) set.email = values.email;
      else if (stored !== values.email) {
        conflicts.push({
          contactId: matched._id,
          field: 'email',
          stored,
          submitted: values.email,
        });
      }
    }

    if (values.phone) {
      const stored = normalizePhone(matched.phone);
      if (!stored) set.phone = values.phone;
      else if (!phonesMatch(stored, values.phone)) {
        conflicts.push({
          contactId: matched._id,
          field: 'phone',
          stored,
          submitted: values.phone,
        });
      }
    }

    if (values.dateOfBirth && !matched.dateOfBirth) {
      set.dateOfBirth = values.dateOfBirth;
    }

    if (Object.keys(set).length) {
      // `nameKey` / `dobKey` are stamped by the schema's update hook, so a
      // filled date of birth brings the contact into the identity indexes
      // without this call site knowing they exist.
      await this.contactModel.updateOne(
        { _id: matched._id },
        { $set: set },
        sessionOptions(deps.session),
      );
    }

    return conflicts;
  }
}
