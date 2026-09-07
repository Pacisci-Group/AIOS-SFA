import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';
import { TenantRecord } from '../../common/schemas/tenant-record.schema';

export type HouseholdMemberDocument = HydratedDocument<HouseholdMember>;

/** Where a membership came from, for reconciliation (PAC-91 §6). */
export const HOUSEHOLD_MEMBER_SOURCES = [
  'smartsuite',
  'intake',
  'manual',
  'seed',
] as const;

export type HouseholdMemberSource = (typeof HOUSEHOLD_MEMBER_SOURCES)[number];

/**
 * Who belongs to a household — the join collection (PAC-91 §5, §6).
 *
 * ── Why a collection and not an array ───────────────────────────────────────
 * The owner's ground truth (David, 2026-09-04): *a contact can belong to
 * several households, but is the primary contact of at most one.* Membership is
 * therefore many-to-many, and the two shapes the schema used before could each
 * only hold half of it:
 *
 * - `Contact.householdId` — one link per person. Adding a second household
 *   overwrote the first, so `link-entities.step.ts` actively **lost**
 *   memberships while the old household still listed the contact. The two sides
 *   then disagreed and nothing reconciled them.
 * - `Household.memberContactIds` — one list per household, with nowhere to put
 *   the two facts that belong to the *pair* rather than to either end.
 *
 * Those two facts are what make this a collection rather than
 * `Contact.householdIds: ObjectId[]`:
 *
 * 1. **{@link role} is per membership.** The same person is a "Named Insured"
 *    at home and a "Driver" on their parents' policy. Stored on the contact it
 *    can only be true of one of them, which is how `Contact.roleInHousehold`
 *    came to be wrong for every multi-household contact.
 * 2. **{@link endedAt} is per membership.** Somebody leaving one household is
 *    not the same event as the contact ceasing to exist, and a `$pull` from an
 *    array leaves no record that they were ever there.
 *
 * ── Primacy is deliberately NOT here ────────────────────────────────────────
 * There is no `isPrimary` on a membership. Primacy lives on
 * `Household.primaryContactId` — one field, one owner of the fact — enforced
 * across households by the partial unique index on
 * `{ agencyId, primaryContactId }`. A flag here would be a second place to
 * store the same thing, which is the mistake this whole ticket is about;
 * `Contact.isPrimary` (removed with this change) was exactly that flag one
 * level up. Readers derive `isPrimary` per household by comparing the contact
 * id with the household's `primaryContactId`.
 *
 * ── Soft end, not delete ────────────────────────────────────────────────────
 * Ending a membership sets {@link endedAt}; the row stays. A current membership
 * is `{ endedAt: null }`, which in MongoDB also matches a document where the
 * field is absent, so a row written before the field existed still reads as
 * current. Re-adding a contact to a household they left revives the same row
 * rather than inserting a second one — which is what the unique index below
 * makes true rather than merely intended.
 */
@Schema({ timestamps: true, collection: 'householdMembers' })
export class HouseholdMember extends TenantRecord {
  @Prop({ type: ObjectIdType, ref: 'Household', required: true })
  householdId: Types.ObjectId;

  @Prop({ type: ObjectIdType, ref: 'Contact', required: true })
  contactId: Types.ObjectId;

  /**
   * The relationship *in this household* — a `CONTACT_ROLES` value, or the free
   * text a migrated row carried. Optional: 322 contacts in the 2026-09-04
   * export have no role recorded at all, and inventing "Named Insured" for them
   * would write a guess down as a fact.
   */
  @Prop({ trim: true })
  role?: string;

  /**
   * When the contact joined. Seeded from the household's `createdAt` for
   * migrated rows rather than from the migration's clock — "joined the day we
   * imported them" is a date nobody can act on.
   */
  @Prop({ type: Date, required: true })
  addedAt: Date;

  /** Set when the membership ends. `null` — or absent — means current. */
  @Prop({ type: Date, default: null })
  endedAt?: Date | null;

  /**
   * Provenance, for the §6 reconciliation count.
   *
   * `type: String` explicitly — the TypeScript type is a union of literals, and
   * `@nestjs/mongoose` refuses to infer a schema type from one ("union/
   * intersection/ambiguous type was used"). Deliberately not a Mongoose `enum`:
   * a row written by a future writer with a value not yet in the list should be
   * stored and read, not rejected at the schema layer.
   */
  @Prop({ type: String, trim: true })
  source?: HouseholdMemberSource;
}

export const HouseholdMemberSchema =
  SchemaFactory.createForClass(HouseholdMember);

/**
 * One row per (household, contact) — the whole basis of idempotency here.
 *
 * Every writer upserts on this key, so re-running the seed migration, replaying
 * an intake submission, or re-adding somebody who left all converge on the same
 * single row. Unique rather than merely indexed because the alternative is
 * duplicate memberships that no reader can tell apart, and because the seed
 * migration relies on E11000 to skip work it has already done.
 *
 * Not partial: all three fields are required, so every document is indexed.
 */
HouseholdMemberSchema.index(
  { agencyId: 1, householdId: 1, contactId: 1 },
  { unique: true },
);

/**
 * "Which households is this person in?" — the query that replaces
 * `Contact.householdId`.
 *
 * Serves `ResolveHouseholdStep`'s derivation, `ContactAccessService`'s
 * ownership probe and the Clients-page contact search, so it earns its write
 * cost several times over.
 */
HouseholdMemberSchema.index({ agencyId: 1, contactId: 1 });
