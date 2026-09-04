import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

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

  @Prop({ type: [String], default: [] })
  emails: string[];

  @Prop({ type: [String], default: [] })
  phones: string[];

  @Prop({ type: Date })
  dateOfBirth?: Date;

  @Prop()
  roleInHousehold?: string;

  @Prop({ default: false })
  isPrimary: boolean;

  @Prop()
  notes?: string;

  @Prop({ type: Types.ObjectId, ref: 'Household', index: true })
  householdId?: Types.ObjectId;

  @Prop({ index: true })
  legacyHouseholdId?: string;

  @Prop({ default: false, index: true })
  isTestRecord: boolean;
}

export const ContactSchema = SchemaFactory.createForClass(Contact);
ContactSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
ContactSchema.index({ agencyId: 1, householdId: 1 });

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
