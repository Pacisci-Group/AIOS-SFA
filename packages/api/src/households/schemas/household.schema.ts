import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TenantRecord } from '../../common/schemas/tenant-record.schema';

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
}

export const HouseholdSchema = SchemaFactory.createForClass(Household);
HouseholdSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  { unique: true, sparse: true },
);
HouseholdSchema.index({ agencyId: 1, name: 1 });
