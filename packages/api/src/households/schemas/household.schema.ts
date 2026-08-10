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
// NOT unique — an apartment building or a house share legitimately yields
// several households on one `street|zip`.
HouseholdSchema.index(
  { agencyId: 1, addressKey: 1 },
  { partialFilterExpression: { addressKey: { $type: 'string' } } },
);
