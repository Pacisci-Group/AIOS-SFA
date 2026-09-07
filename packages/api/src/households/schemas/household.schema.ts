import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type HouseholdDocument = HydratedDocument<Household>;

/**
 * Migrated from SmartSuite "The Households Table" (6941fa11964c58f31380427c).
 * Provides the household context for scorecards (avg premium / HH) and hot leads.
 */
@Schema({ timestamps: true, collection: 'households' })
export class Household extends TenantRecord {
  /**
   * Human-readable, agency-unique identifier — `HH-2614` (PAC-56 #7).
   *
   * ⚠ Not a foreign key. Everywhere else in the codebase `householdId` is the
   * ObjectId that points *at* a household (`Lead`, `Contact`, `QuoteRecap`,
   * `Policy`, …); this is the number a producer reads aloud, and the two are
   * deliberately named apart.
   *
   * Migrated households keep the number SmartSuite gave them (`#HH2614`);
   * everything created since is allocated from the agency's counter by
   * `allocateHouseholdRef`. Optional because a household written before this
   * field existed has none until `reconcileHouseholdRefs` next runs — which the
   * migration and the demo seed both do at the end of their household pass.
   */
  @Prop({ trim: true, uppercase: true })
  householdRef?: string;

  @Prop({ trim: true })
  name?: string;

  @Prop({ index: true })
  status?: string;

  @Prop({ type: Object })
  propertyAddress?: Record<string, unknown>;

  @Prop({ type: Object })
  mailingAddress?: Record<string, unknown>;

  /*
   * ⚠ No `primaryContactName` / `primaryEmails` / `primaryPhones`, deliberately
   * (PAC-91 §1, §4).
   *
   * The household used to carry a denormalised copy of its primary contact's
   * name, email and phone. Only lead intake ever wrote it, so every migrated
   * household had all three empty and every reader that consulted them first
   * rendered an em dash — the gap PAC-86 patched in one drawer and left
   * everywhere else. Nothing kept the copy in step either, which §7 makes
   * decisive: promoting a new primary after a death would otherwise leave a
   * dead person's phone number on the record indefinitely.
   *
   * Resolve the primary contact through `primaryContactId` below instead —
   * `loadPrimaryContacts` in `households/primary-contact.ts` does it in one
   * batched query, and `ClientsService` resolves it in the list aggregation.
   */

  @Prop({ type: ObjectIdType, ref: 'User' })
  assignedCrmId?: Types.ObjectId;

  @Prop()
  legacyAssignedCrmId?: string;

  @Prop({ default: 0 })
  totalActivePolicies: number;

  @Prop({ default: false, index: true })
  isTestRecord: boolean;

  /**
   * The household's primary contact — the whole of the fact, and the only
   * place it lives (PAC-91 §5).
   *
   * Set on create, and on reuse only when currently unset: a second lead for an
   * existing household must not reassign whoever its primary already is.
   * Reassignment is a deliberate operation of its own (PAC-91 §7).
   *
   * A contact is the primary of **at most one** household (David, 2026-09-04),
   * enforced by the partial unique index below rather than only by application
   * code. `Contact.isPrimary` used to say the same thing from the other end and
   * could not answer "primary *of what?*" once membership went many-to-many;
   * it is gone.
   */
  @Prop({ type: ObjectIdType, ref: 'Contact', index: true })
  primaryContactId?: Types.ObjectId;

  /*
   * ⚠ No `memberContactIds`, deliberately (PAC-91 §5).
   *
   * Membership is many-to-many and carries two facts that belong to the *pair*
   * — the contact's role in this household, and when they left — neither of
   * which an array of ids can hold. Ending a membership by `$pull` would also
   * leave no record that the person was ever here, which is the loss §5
   * describes from the other side. It lives in the `householdMembers`
   * collection now; read it through `HouseholdMembersService`.
   */

  @Prop({ type: [{ type: ObjectIdType, ref: 'Lead' }], default: [] })
  leadIds: Types.ObjectId[];

  /**
   * `"<street>|<zip>"`, both lowercased + trimmed.
   *
   * Stored for future use, **not** read by intake: households are derived from
   * the resolved contact, never looked up by address. Address-based household
   * merging is unsafe (apartment buildings without unit numbers, roommates,
   * prior owners), and legacy agrees in practice — it writes `address_key` and
   * never queries it. The lead-side `addressKey` is the dedupe signal.
   */
  @Prop({ trim: true, lowercase: true })
  addressKey?: string;
}

export const HouseholdSchema = SchemaFactory.createForClass(Household);
HouseholdSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
HouseholdSchema.index({ agencyId: 1, name: 1 });
// Unique per agency — the whole reason the reference replaced the ObjectId-derived
// label is that it can be trusted to identify one household. Partial, not sparse,
// for the reason spelled out on LEGACY_DEDUPE_INDEX_OPTIONS: a compound sparse
// index still indexes documents that have `agencyId`, so every household still
// awaiting a backfill would collide on `(agencyId, null)`.
HouseholdSchema.index(
  { agencyId: 1, householdRef: 1 },
  {
    unique: true,
    partialFilterExpression: { householdRef: { $type: 'string' } },
  },
);
// NOT unique — an apartment building or a house share legitimately yields
// several households on one `street|zip`.
HouseholdSchema.index(
  { agencyId: 1, addressKey: 1 },
  { partialFilterExpression: { addressKey: { $type: 'string' } } },
);

/**
 * "Primary of at most one household" as an index (PAC-91 §5).
 *
 * Partial, not sparse, for the reason spelled out on `householdRef` above: a
 * compound sparse index still indexes every document that has `agencyId`, so
 * the 77 households with no primary contact would all collide on
 * `(agencyId, null)`.
 *
 * ⚠ Declared here **and** built by
 * `migrations/…-household-primary-contact-index.js`, deliberately — the same
 * arrangement as the contact identity indexes and for the same reason.
 * `autoIndex` creates a missing index silently and a unique build over
 * conflicting data simply fails, leaving no uniqueness and nothing naming the
 * rows responsible. The migration checks first and throws, naming them.
 */
HouseholdSchema.index(
  { agencyId: 1, primaryContactId: 1 },
  {
    unique: true,
    partialFilterExpression: { primaryContactId: { $type: 'objectId' } },
  },
);
