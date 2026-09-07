import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  contactIdentity,
  hasCompleteIdentity,
  type ContactIdentity,
  type ContactIdentitySource,
} from './contact-identity';
import { Contact, ContactDocument } from './schemas/contact.schema';

/** The fields a duplicate hit hands back — enough to offer "use existing". */
export interface DuplicateContact {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dateOfBirth?: Date;
  householdId?: Types.ObjectId;
  legacyHouseholdId?: string;
}

/**
 * The one duplicate check every contact-creating path shares (PAC-91 §9).
 *
 * The owner's rule — **DOB + full name + phone or email** — was enforced
 * nowhere: intake's fuzzy scorer deliberately resolves ambiguity toward
 * "create a new contact", and the Household form and the migration had no check
 * at all. The 2026-09-04 export already carried 47 full-key duplicate groups.
 *
 * This is the *definite* half of that judgement, and only the definite half. A
 * full-key hit is the same person and callers act on it without further
 * scoring. Everything short of a full key stays with `contact-match.ts`, whose
 * governing principle is unchanged and still right: creating a duplicate is
 * recoverable, merging two different people is not.
 *
 * The two partial unique indexes on `ContactSchema` are the backstop for the
 * race this check cannot win — two concurrent submissions both finding nothing.
 * {@link assertNoDuplicate} and {@link toConflict} map both outcomes onto the
 * same 409, so the caller does not care which one fired.
 */
@Injectable()
export class ContactIdentityService {
  constructor(
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
  ) {}

  /**
   * The existing contact this person *is*, or null.
   *
   * ⚠ Not scoped to a household, deliberately: a person is one person across
   * the agency, and confining the check to one household is precisely how the
   * pinned-intake filter in `resolve-contact.step.ts` came to create duplicates
   * of members who already existed elsewhere.
   *
   * Test records are excluded: the seeded Sample/Test rows share names by
   * design and must never block a real contact.
   */
  async findDuplicate(
    agencyId: string,
    person: ContactIdentitySource,
    options: { excludeId?: Types.ObjectId; session?: unknown } = {},
  ): Promise<DuplicateContact | null> {
    const identity = contactIdentity(person);
    if (!hasCompleteIdentity(identity)) return null;

    const query = this.contactModel
      .findOne(buildIdentityFilter(agencyId, identity, options.excludeId))
      .select(
        'firstName lastName email phone dateOfBirth householdId legacyHouseholdId',
      );
    if (options.session) query.session(options.session as never);

    return query.lean<DuplicateContact | null>();
  }

  /**
   * Throw a 409 when this person already exists.
   *
   * The response carries the existing `contactId` so the UI can offer "use the
   * existing contact" rather than only refusing — a refusal with no id leaves
   * the user unable to do the right thing.
   */
  async assertNoDuplicate(
    agencyId: string,
    person: ContactIdentitySource,
    options: { excludeId?: Types.ObjectId; session?: unknown } = {},
  ): Promise<void> {
    const existing = await this.findDuplicate(agencyId, person, options);
    if (existing) throw toConflict(existing);
  }
}

/**
 * The filter behind {@link ContactIdentityService.findDuplicate} — exported so
 * `merge-duplicate-contacts.ts` groups by exactly the rule the API enforces.
 *
 * `$or` over the two legs, not a `$or` of the whole identity: name and DOB must
 * *both* match, and then either contact detail. Only the legs the person
 * actually has are offered, so a person with an email and no phone is compared
 * on email alone rather than matching every phone-less namesake.
 */
export function buildIdentityFilter(
  agencyId: string,
  identity: ContactIdentity,
  excludeId?: Types.ObjectId,
): FilterQuery<ContactDocument> {
  const legs: FilterQuery<ContactDocument>[] = [];
  if (identity.phone) legs.push({ phone: identity.phone });
  if (identity.email) legs.push({ email: identity.email });

  return {
    agencyId,
    nameKey: identity.nameKey,
    dobKey: identity.dobKey,
    isTestRecord: { $ne: true },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    $or: legs,
  };
}

/** The 409 every path returns for the same person twice. */
export function toConflict(existing: DuplicateContact): ConflictException {
  const name =
    [existing.firstName, existing.lastName].filter(Boolean).join(' ').trim() ||
    'this contact';
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: `${name} already exists in this agency`,
    // The whole point of the 409: the client can offer "use the existing
    // contact" instead of leaving the user with a dead end.
    contactId: existing._id.toString(),
    householdId: existing.householdId?.toString() ?? null,
  });
}
