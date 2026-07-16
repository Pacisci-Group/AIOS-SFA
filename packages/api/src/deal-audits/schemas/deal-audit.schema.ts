import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TenantRecord } from '../../common/schemas/tenant-record.schema';

export type DealAuditDocument = HydratedDocument<DealAudit>;

/**
 * Migrated from SmartSuite "The Deal Audits Table" (6941fdb2dc9a6d024fd8caef).
 * The parent audit summary for a deal (rolls up Deal Audit Items -> auditRecords).
 */
@Schema({ timestamps: true, collection: 'dealAudits' })
export class DealAudit extends TenantRecord {
  @Prop({ trim: true })
  title?: string;

  @Prop()
  auditId?: string;

  @Prop({ type: Date })
  auditDate?: Date;

  @Prop()
  result?: string;

  @Prop({ type: [String], default: [] })
  reasonCodes: string[];

  @Prop({ default: 0 })
  auditScore: number;

  @Prop()
  auditNotes?: string;

  @Prop({ type: Types.ObjectId, ref: 'Deal', index: true })
  dealId?: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  legacyDealIds: string[];

  @Prop({ default: false, index: true })
  isTestRecord: boolean;
}

export const DealAuditSchema = SchemaFactory.createForClass(DealAudit);
DealAuditSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  { unique: true, sparse: true },
);
