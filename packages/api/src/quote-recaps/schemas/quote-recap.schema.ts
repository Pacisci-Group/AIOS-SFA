import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type QuoteRecapDocument = HydratedDocument<QuoteRecap>;

/**
 * Migrated from SmartSuite "The Quote Recaps Table" (6941fdb2dc9a6d024fd8bc53).
 * Backs the Quoted scorecard.
 */
@Schema({ timestamps: true, collection: 'quoteRecaps' })
export class QuoteRecap extends TenantRecord {
  @Prop({ trim: true })
  title?: string;

  @Prop()
  quoteRecapAutoNumber?: number;

  @Prop({ type: Date, index: true })
  quoteDate?: Date;

  @Prop({ default: 0 })
  premium: number;

  @Prop({ default: 0 })
  itemCount: number;

  @Prop({ type: [String], default: [] })
  productsQuoted: string[];

  @Prop()
  recapStatus?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  producerId?: Types.ObjectId;

  @Prop({ index: true })
  legacyProducerId?: string;

  @Prop()
  legacyLeadId?: string;

  @Prop()
  legacyHouseholdId?: string;

  @Prop({ default: false, index: true })
  isTestRecord: boolean;
}

export const QuoteRecapSchema = SchemaFactory.createForClass(QuoteRecap);
QuoteRecapSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
QuoteRecapSchema.index({ agencyId: 1, producerId: 1, quoteDate: -1 });
