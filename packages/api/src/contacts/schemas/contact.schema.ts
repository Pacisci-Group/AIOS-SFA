import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';
import {
  CONTACT_IDENTITY_INDEXES,
  stampIdentityKeys,
  stampIdentityKeysOnUpdate,
} from '../contact-identity';

export type ContactDocument = HydratedDocument<Contact>;

/**
 * Migrated from SmartSuite "The Contacts Table" (6941fb21eea41b87f26cd10d).
 * Household members (Named Insured, Spouse, Driver, Child, ...).
 */
@Schema({ timestamps: true, collection: 'contacts' })
export class Contact extends TenantRecord {
  @Prop({ trim: true })
  firstName?: string;

  @Prop({ trim: true })
  lastName?: string;

  /**
   * One email and one phone, because a contact is one person (PAC-91 §1).
   *
   * These were `emails: string[]` / `phones: string[]`, which copied
   * SmartSuite's *field type* — its Email field is `string[]`, its Phone field
   * `phone[]` — rather than the domain. Legacy always read and wrote a single
   * value, every consumer here read `[0]`, and the 2026-09-04 production export
   * has **zero** contacts with a second email or phone. The arrays only ever
   * grew because intake `$addToSet`-ed a conflicting submission onto them.
   *
   * Stored normalised, through `intake.normalize.ts`: email lowercased and
   * trimmed, phone reduced to digits. Contact matching compares stored values
   * against those exact shapes, so a writer that stores a raw value silently
   * breaks dedupe.
   */
  @Prop({ trim: true, lowercase: true })
  email?: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ type: Date })
  dateOfBirth?: Date;

  @Prop()
  notes?: string;

  /*
   * ⚠ No `householdId`, `legacyHouseholdId`, `isPrimary` or `roleInHousehold`,
   * deliberately (PAC-91 §5, §6).
   *
   * All four were SmartSuite's shape rather than the domain's — its `Household`
   * field on a contact is a single link — and the owner's ground truth
   * (2026-09-04) is that a contact can belong to **several** households while
   * being the primary of at most one:
   *
   * - `householdId` / `legacyHouseholdId` held one membership. Linking a
   *   contact to a second household `$set` over the first, so the contact lost
   *   it while the old household went on listing them.
   * - `isPrimary` could not answer "primary *of what?*", already duplicated
   *   `Household.primaryContactId`, and legacy stamped it `true` on every
   *   contact it created.
   * - `roleInHousehold` is a property of the *pair*: "Named Insured" at home,
   *   "Driver" on a parent's policy.
   *
   * Membership, role and end-date live in the `householdMembers` collection
   * (`households/household-member.schema.ts`); primacy stays the single
   * `Household.primaryContactId`. A household-scoped response derives
   * `isPrimary` by comparing ids — there is no contact-global flag to read.
   */

  @Prop({ default: false, index: true })
  isTestRecord: boolean;

  /**
   * `"<first> <last>"`, lowercased with internal whitespace collapsed — the
   * name half of the owner's identity rule (PAC-91 §9: a contact is unique on
   * **DOB + full name + phone or email**).
   *
   * A stored key rather than a query-time expression because it is an *index*
   * leg: the two unique indexes below cannot be built over a computed value,
   * and a collation-based comparison cannot express "these four fields together
   * are unique". Stamped by the hook below so no writer can forget it.
   */
  @Prop({ trim: true, lowercase: true })
  nameKey?: string;

  /**
   * `YYYY-MM-DD` in UTC, from {@link Contact.dateOfBirth} — the DOB half of the
   * same rule.
   *
   * A string, not the `Date`, so the index leg is `$type: 'string'` like the
   * other three and the partial filter can require all four uniformly.
   */
  @Prop({ trim: true })
  dobKey?: string;
}

export const ContactSchema = SchemaFactory.createForClass(Contact);
ContactSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
/**
 * Person-first contact matching (PAC-37): the first+last name candidate query.
 *
 * The collation makes it case-insensitive (`strength: 2` also ignores accents)
 * without adding lowercase key columns and backfilling every migrated contact —
 * legacy's equivalent query was a case-sensitive exact match, which quietly
 * created a duplicate for "mcdonald" vs "McDonald".
 *
 * ⚠ Every `find()` that means to use this index **must repeat the same
 * `.collation()`**. Omit it and the query silently reverts to case-sensitive
 * matching *and* falls back to a collection scan.
 */
ContactSchema.index(
  { agencyId: 1, lastName: 1, firstName: 1 },
  { collation: { locale: 'en', strength: 2 } },
);

/**
 * Date-of-birth search on the Clients page (PAC-89).
 *
 * DOB is the one identifier there with no fallback path: a caller who has a
 * date of birth generally has it *because* the name was ambiguous or misspelt,
 * so the query that serves them cannot be the one that scans the collection.
 *
 * No collation — this index is only ever used for a range on a `Date`.
 */
ContactSchema.index({ agencyId: 1, dateOfBirth: 1 });

/**
 * Email / phone lookup (PAC-91 §1).
 *
 * Replaces the `$regex`-over-an-array search the Leads list ran against the
 * lead's own denormalised copy: with that copy gone, an email or phone search
 * resolves contacts first and filters leads by `primaryContactId`. Partial on
 * `$type: 'string'` rather than sparse — a compound index that also carries
 * `agencyId` still indexes every document that has one, so a sparse index here
 * would index the whole collection and defeat the point.
 */
ContactSchema.index(
  { agencyId: 1, email: 1 },
  { partialFilterExpression: { email: { $type: 'string' } } },
);
ContactSchema.index(
  { agencyId: 1, phone: 1 },
  { partialFilterExpression: { phone: { $type: 'string' } } },
);

/**
 * The owner's identity rule as two partial unique indexes (PAC-91 §9).
 *
 * The rule is an **OR** — same name, same DOB, and the same phone *or* the same
 * email — so it takes two indexes; and every leg is optional (on the production
 * dump 322 contacts have no DOB and 611 have neither phone nor email), so each
 * is partial on all four legs being present. A row missing a leg is simply not
 * indexed, which is the honest position: without a DOB we cannot call two rows
 * the same person, and a unique index that pretended otherwise would refuse
 * legitimate data.
 *
 * ⚠ Declared here **and** built by a migration, deliberately. `autoIndex`
 * creates a missing index silently, and building a unique index over a database
 * that still holds duplicates fails at boot with nothing said about which rows
 * caused it. `migrations/…-contact-identity-indexes.js` checks for conflicts
 * first and fails loudly, naming them — which is what stops a deploy that
 * skipped `merge-duplicate-contacts.ts`.
 */
for (const keys of CONTACT_IDENTITY_INDEXES) {
  ContactSchema.index(keys, {
    unique: true,
    partialFilterExpression: Object.fromEntries(
      Object.keys(keys).map((field) => [field, { $type: 'string' }]),
    ),
  });
}

/**
 * Keep `nameKey` / `dobKey` in step with the fields they are derived from.
 *
 * On every write path Mongoose offers a hook for, because the alternative —
 * each writer remembering to stamp them — is exactly how a uniqueness rule
 * stops being enforced: one forgotten call site leaves the row out of the
 * partial index and the duplicate it was meant to prevent is created without
 * error. `Model.bulkWrite()` still bypasses all of this (see `AGENTS.md` §11);
 * the merge script and the migration compute the keys themselves.
 */
ContactSchema.pre('save', function stampOnSave(next) {
  stampIdentityKeys(this);
  next();
});
for (const hook of ['updateOne', 'findOneAndUpdate', 'updateMany'] as const) {
  ContactSchema.pre(hook, function stampOnUpdate(next) {
    stampIdentityKeysOnUpdate(this.getUpdate());
    next();
  });
}
ContactSchema.pre(
  'insertMany',
  function stampOnInsertMany(next, docs: unknown[]) {
    for (const doc of docs) stampIdentityKeys(doc);
    next();
  },
);
