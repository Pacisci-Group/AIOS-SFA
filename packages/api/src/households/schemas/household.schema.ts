import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
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

  @Prop({ trim: true })
  primaryContactName?: string;

  @Prop({ type: [String], default: [] })
  primaryEmails: string[];

  @Prop({ type: [String], default: [] })
  primaryPhones: string[];

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedCrmId?: Types.ObjectId;

  @Prop()
  legacyAssignedCrmId?: string;

  @Prop({ default: 0 })
  totalActivePolicies: number;

  @Prop({ default: false, index: true })
  isTestRecord: boolean;

  /**
   * Set on create, and on reuse only when currently unset — a second lead for an
   * existing household must not reassign whoever its primary already is.
   */
  @Prop({ type: Types.ObjectId, ref: 'Contact', index: true })
  primaryContactId?: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Contact' }], default: [] })
  memberContactIds: Types.ObjectId[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Lead' }], default: [] })
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
