import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TenantRecord } from '../../common/schemas/tenant-record.schema';

export type ProducerGoalDocument = HydratedDocument<ProducerGoal>;

/**
 * New collection (no legacy source). Producer x month x goal, used by the
 * Leaderboard / Motivation Hub "% to goal". Scaffolded during migration from the
 * Users table Monthly Goal (s72ea8dfab) for the current month.
 */
@Schema({ timestamps: true, collection: 'producerGoals' })
export class ProducerGoal extends TenantRecord {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  producerId: Types.ObjectId;

  @Prop({ index: true })
  legacyProducerId?: string;

  /** Goal month in YYYY-MM (agency timezone). */
  @Prop({ required: true })
  month: string;

  @Prop({ default: 0 })
  goalPremium: number;

  @Prop({ default: 'migration:user-monthly-goal' })
  source: string;
}

export const ProducerGoalSchema = SchemaFactory.createForClass(ProducerGoal);
ProducerGoalSchema.index(
  { agencyId: 1, producerId: 1, month: 1 },
  { unique: true },
);
