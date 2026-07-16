import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TenantRecord } from '../../common/schemas/tenant-record.schema';

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
  { unique: true, sparse: true },
);
ContactSchema.index({ agencyId: 1, householdId: 1 });
