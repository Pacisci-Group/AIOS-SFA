import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TenantRecord } from '../../common/schemas/tenant-record.schema';

export type DealAuditItemDocument = HydratedDocument<DealAuditItem>;

/**
 * Migrated from SmartSuite "The Deal Audit Items Table" (69533b022b0995e027431c02).
 * Individual checklist rows under a Deal Audit; backs the Deals Pending Service
 * Hand-off board (each open item is a row).
 */
@Schema({ timestamps: true, collection: 'dealAuditItems' })
export class DealAuditItem extends TenantRecord {
  @Prop({ trim: true })
  title?: string;

  @Prop({ type: Types.ObjectId, ref: 'Deal', index: true })
  dealId?: Types.ObjectId;

  @Prop({ index: true })
  legacyDealId?: string;

  @Prop()
  itemName?: string;

  @Prop()
  category?: string;

  /** Raw SmartSuite status value (sdb5069dbd): backlog | in_progress (=Failed) | complete. */
  @Prop()
  status?: string;

  @Prop()
  statusLabel?: string;

  /** Update/verification status (s5cd2f1d5a): backlog | in_progress | complete. */
  @Prop()
  updateStatus?: string;

  @Prop()
  updateStatusLabel?: string;

  /** Item failed the audit and still needs producer action (hand-off pending). */
  @Prop({ default: false, index: true })
  isFailed: boolean;

  @Prop({ default: false, index: true })
  isResolved: boolean;

  @Prop({ default: false })
  required: boolean;

  @Prop({ default: false })
  blocking: boolean;

  @Prop({ default: true })
  applicable: boolean;

  @Prop({ trim: true })
  clientName?: string;

  @Prop({ trim: true })
  producerName?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  producerId?: Types.ObjectId;

  @Prop({ default: 0 })
  daysOpen: number;

  @Prop({ type: Date })
  firstCreatedAt?: Date;

  @Prop({ default: false, index: true })
  isTestRecord: boolean;
}

export const DealAuditItemSchema = SchemaFactory.createForClass(DealAuditItem);
DealAuditItemSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  { unique: true, sparse: true },
);
DealAuditItemSchema.index({
  agencyId: 1,
  producerId: 1,
  isFailed: 1,
  isResolved: 1,
});
