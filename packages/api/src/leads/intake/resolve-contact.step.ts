import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PRIMARY_HOUSEHOLD_ROLE } from '@sfa/shared';
import type { HouseholdMemberRole } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  Contact,
  ContactDocument,
} from '../../contacts/schemas/contact.schema';
import { pickBestContact } from './contact-match';
import {
  normalizeEmail,
  normalizeName,
  normalizePhone,
  parseDateOfBirth,
  phonesMatch,
} from './intake.normalize';
import {
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

/** Step 1 — person-first contact resolution. */
@Injectable()
export class ResolveContactStep {
  constructor(
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
  ) {}

  /**
   * @param householdId When the intake is pinned to a household, matching is
   *   confined to **that household's** contacts. The household is a fact here,
   *   not something to infer, so an agency-wide name hit is the wrong answer
   *   twice over: `LinkEntitiesStep` would move a stranger's contact into this
   *   household, and the household they came from would silently lose them.
   *   Confining it can only produce a duplicate contact — recoverable, and the
   *   trade this file already makes everywhere else.
   */
  async run(
    person: IntakePerson,
    role: 'primary' | HouseholdMemberRole,
    deps: StepDeps,
    householdId?: Types.ObjectId,
  ): Promise<ResolvedContact> {
    const firstName = normalizeName(person.firstName);
    const lastName = normalizeName(person.lastName);
    const email = normalizeEmail(person.email);
    const phone = normalizePhone(person.phone);
    const dateOfBirth = parseDateOfBirth(person.dateOfBirth);

    // `.collation(...)` MUST match the index declared on ContactSchema — drop it
    // and the match silently becomes case-sensitive AND scans the collection.
    const candidates = await this.contactModel
      .find({
        agencyId: deps.ctx.agencyId,
        firstName,
        lastName,
        isTestRecord: { $ne: true },
        ...(householdId ? { householdId } : {}),
      })
      .collation(NAME_COLLATION)
      .limit(CANDIDATE_LIMIT)
      .session(deps.session)
      .lean();

    const matched = pickBestContact(candidates, { dateOfBirth, email, phone });

    if (matched) {
      await this.mergeIntoExisting(
        matched,
        { email, phone, dateOfBirth },
        deps,
      );
      return {
        contactId: matched._id,
        isNew: false,
        householdId: matched.householdId,
        legacyHouseholdId: matched.legacyHouseholdId,
      };
    }

    const [created] = await this.contactModel.create(
      [
        {
          agencyId: deps.ctx.agencyId,
          branchId: deps.ctx.branchId,
          firstName,
          lastName,
          emails: email ? [email] : [],
          phones: phone ? [phone] : [],
          dateOfBirth: dateOfBirth ?? undefined,
          // Legacy stamped `isPrimary: true` on EVERY contact it created,
          // including household members, because members were routed through the
          // same function with no role parameter.
          isPrimary: role === 'primary',
          roleInHousehold: role === 'primary' ? PRIMARY_HOUSEHOLD_ROLE : role,
          isTestRecord: false,
        },
      ],
      sessionOptions(deps.session),
    );

    deps.created.track(this.contactModel, created._id);
    return { contactId: created._id, isNew: true };
  }

  /**
   * Additive merge onto a matched contact. Never destructive: a lead form is a
   * weak source of truth about an existing client, so it may add a newly-supplied
   * email or phone and fill a blank date of birth, but must not overwrite a
   * value someone already curated — and must never touch `roleInHousehold`,
   * which would let a form demote a Named Insured to "Child".
   */
  private async mergeIntoExisting(
    matched: Pick<ContactDocument, '_id' | 'emails' | 'phones' | 'dateOfBirth'>,
    values: {
      email: string | null;
      phone: string | null;
      dateOfBirth: Date | null;
    },
    deps: StepDeps,
  ): Promise<void> {
    const addToSet: Record<string, string> = {};
    const set: Record<string, Date> = {};

    // Compare normalised-to-normalised so we don't append `pat@x.com` alongside
    // a stored `Pat@X.com`; $addToSet alone is only exact-match idempotent.
    if (values.email) {
      const existing = (matched.emails ?? []).map(normalizeEmail);
      if (!existing.includes(values.email)) addToSet.emails = values.email;
    }
    if (values.phone) {
      const existing = (matched.phones ?? []).map(normalizePhone);
      if (!existing.some((p) => phonesMatch(p, values.phone))) {
        addToSet.phones = values.phone;
      }
    }
    if (values.dateOfBirth && !matched.dateOfBirth) {
      set.dateOfBirth = values.dateOfBirth;
    }

    const hasAddToSet = Object.keys(addToSet).length > 0;
    const hasSet = Object.keys(set).length > 0;
    if (!hasAddToSet && !hasSet) return;

    await this.contactModel.updateOne(
      { _id: matched._id },
      {
        ...(hasAddToSet ? { $addToSet: addToSet } : {}),
        ...(hasSet ? { $set: set } : {}),
      },
      sessionOptions(deps.session),
    );
  }
}
