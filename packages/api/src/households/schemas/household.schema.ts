import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { StoredAddress } from '@sfa/shared';
import { householdAddressKey } from '../../common/address/address-key';
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
/**
 * A stored household address (PAC-101).
 *
 * ## Why this is a sub-schema now
 *
 * `propertyAddress` and `mailingAddress` were `@Prop({ type: Object })`, and
 * **three writers each used their own key names** — lead intake wrote
 * `street/city/state/zip`, the demo seed `line1/…`, and the SmartSuite
 * migration passed the vendor's `location_address/location_city/…` through
 * verbatim. So `{"propertyAddress.city": …}` matched only some rows, and the
 * city the Clients list shows had to be resolved in application code *after*
 * the fetch — which a Mongo query cannot do, and which is why the Location
 * column was unsearchable.
 *
 * This is what `AGENTS.md` §11 asks for: model the domain, not the shape the
 * source system happened to use. `BranchAddress` was already doing it.
 *
 * ⚠ **Every field is optional** and every reader must treat it that way. A
 * household with a city and no street is a real record — migrated rows are
 * half-filled all the time. That is why this mirrors `StoredAddress` rather
 * than `StructuredAddress`, whose fields are all required because it is the
 * post-coercion display shape.
 *
 * ⚠ **`strict` bites on write, not on read.** A legacy-keyed document still
 * *reads* back intact (`.lean()` skips hydration, and `$init` keeps paths with
 * no schema entry), but an update carrying `location_city` is silently reduced
 * to `$set: {propertyAddress: {}}` — a 200 that erases the address. That is why
 * the migration and every writer land in the same commit as this class.
 */
@Schema({ _id: false })
export class HouseholdAddress implements StoredAddress {
  @Prop({ trim: true })
  street?: string;

  /**
   * Apartment / unit line, from the SmartSuite `location_address2` column.
   *
   * Recovered rather than dropped: the coercion that read these records
   * ignored it, so it was invisible to every consumer. It stays **out** of
   * `addressKey` — see `householdAddressKey`.
   */
  @Prop({ trim: true })
  street2?: string;

  @Prop({ trim: true })
  city?: string;

  @Prop({ trim: true })
  state?: string;

  @Prop({ trim: true })
  zip?: string;
}
export const HouseholdAddressSchema =
  SchemaFactory.createForClass(HouseholdAddress);

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

  /**
   * The household's **living** address. An insured property address is a
   * different thing entirely and is captured on the quote.
   */
  @Prop({ type: HouseholdAddressSchema })
  propertyAddress?: StoredAddress;

  @Prop({ type: HouseholdAddressSchema })
  mailingAddress?: StoredAddress;

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

  /**
   * Why this household is flagged for someone to come back to (PAC-91 §7).
   *
   * One value today — `no_primary` — and a scalar rather than an array on the
   * `AGENTS.md` §11 test: nothing here can say what a *second* simultaneous flag
   * would mean, so it is not a list. Widen it when a second reason exists.
   *
   * Written **only** by the deliberate "leave this household without a primary
   * contact" path, when a primary has died and no successor can be named. A
   * household that simply never had one — 77 of them on the 2026-09-04
   * production data — is not flagged, because nobody decided that.
   * `primaryContactId: null` already says *what*; this says *somebody chose it
   * and it still needs an answer*. Cleared the moment a primary is assigned.
   *
   * Its one reader is the Unlinked records work list (PAC-91 §10), and that
   * view **projects it, never filters on it**: both classes of household —
   * flagged and never-looked-at — are one list keyed on `primaryContactId`,
   * with the reason shown on the row, because `no_primary` is not a resolution
   * and a count that disagreed with the database would undermine the list.
   *
   * So it stays **unindexed**, deliberately: nothing queries it, and an index
   * for a predicate nobody uses is the cost the two dead `producerId` indexes
   * on `activities` taught.
   */
  @Prop({ type: String, trim: true })
  dataQuality?: string;

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
   * **Not a dedupe key.** Households are derived from the resolved contact,
   * never looked up by address: address-based merging is unsafe (apartment
   * buildings without unit numbers, roommates, prior owners), and legacy agrees
   * in practice — it writes `address_key` and never queries it. The lead-side
   * `addressKey` is the dedupe signal, and the index here is deliberately
   * non-unique.
   *
   * Until PAC-101 only lead intake wrote it, so it was null on every migrated
   * and every demo-seeded household and its index covered a small minority of
   * rows. It is stamped by a hook now (see the bottom of this file) and
   * backfilled by `…-household-address-subschema.js`.
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

/**
 * Keep `addressKey` in step with the address it is derived from.
 *
 * On every write path Mongoose offers a hook for, rather than at each call
 * site, for the reason `ContactSchema` gives for `nameKey`/`dobKey`: one
 * forgotten writer leaves the row out of the partial index silently. Before
 * PAC-101 that was not hypothetical — intake stamped it and the other two
 * writers did not, so the index covered a minority of the collection.
 *
 * ⚠ **`Model.bulkWrite()` bypasses all of this** (`AGENTS.md` §11). The one
 * bulk writer on this collection is `households/household-ref.ts`, whose `$set`
 * carries `householdRef` and nothing else — there is no address in the payload
 * for a hook to read, so it is a hole in name only. Do **not** add manual
 * stamping there; add it if that call ever starts writing addresses.
 *
 * ⚠ Both update shapes are handled. A `$set` may carry the whole address
 * (`propertyAddress: {...}`) or a single path (`'propertyAddress.street'`), and
 * only the first form can be re-derived in full — a dotted update that changes
 * the street without the zip is merged against nothing, so the key is left
 * alone rather than rebuilt from half the address.
 */
function stampAddressKey(doc: {
  propertyAddress?: StoredAddress;
  addressKey?: string | null;
}): void {
  const key = householdAddressKey(doc.propertyAddress);
  if (key) doc.addressKey = key;
}

HouseholdSchema.pre('save', function stampOnSave(next) {
  stampAddressKey(this);
  next();
});

for (const hook of ['updateOne', 'findOneAndUpdate', 'updateMany'] as const) {
  HouseholdSchema.pre(hook, function stampOnUpdate(next) {
    const update = this.getUpdate() as Record<string, unknown> | null;
    if (!update || Array.isArray(update)) return next();

    const set = (update.$set ?? update) as Record<string, unknown>;
    const address = set.propertyAddress as StoredAddress | undefined;
    if (address && typeof address === 'object') {
      const key = householdAddressKey(address);
      if (key) set.addressKey = key;
    }
    next();
  });
}

HouseholdSchema.pre(
  'insertMany',
  function stampOnInsertMany(next, docs: unknown[]) {
    for (const doc of docs) {
      stampAddressKey(doc as Parameters<typeof stampAddressKey>[0]);
    }
    next();
  },
);
