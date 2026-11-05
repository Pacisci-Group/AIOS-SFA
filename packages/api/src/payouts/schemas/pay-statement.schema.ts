import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  PAY_STATEMENT_STATUSES,
  PAYOUT_POOLS,
  STATEMENT_ADJUSTMENT_KINDS,
  type PayoutPool,
  type PayStatementStatus,
  type PremiumLineView,
  type StatementAdjustmentKind,
  type StatementBonusesView,
  type StatementChargebackView,
  type StatementDealView,
  type StatementIndicatorsView,
  type StatementStructureSnapshot,
  type StatementTotalsView,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type PayStatementDocument = HydratedDocument<PayStatement>;

/**
 * A manager's correction (PAC-182 writes them; PAC-178's math applies them).
 * Kept across recalculations: a recalculation recomputes what the data
 * says, and the adjustments are the manager's word on top of it.
 */
@Schema({ _id: true, timestamps: false })
export class PayStatementAdjustment {
  _id: Types.ObjectId;

  @Prop({ type: String, enum: STATEMENT_ADJUSTMENT_KINDS, required: true })
  kind: StatementAdjustmentKind;

  @Prop({ type: ObjectIdType, ref: 'Chargeback', default: null })
  chargebackId: Types.ObjectId | null;

  @Prop({ type: Number, default: null })
  amount: number | null;

  @Prop({ type: String, default: '' })
  note: string;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: Date, required: true })
  createdAt: Date;
}
const PayStatementAdjustmentSchema = SchemaFactory.createForClass(
  PayStatementAdjustment,
);

/**
 * One person's commission statement for one month (PAC-178).
 *
 * **A snapshot, not a view.** Everything the statement says — the structure
 * it was computed with, each line, deal and chargeback, the bonuses, the
 * totals — is stored on it, because a sent statement is a document someone
 * signs: changing the structure, a sale or a chargeback afterwards must not
 * change what they were shown. A recalculation rewrites only `draft` and
 * `rejected` statements.
 *
 * The amounts are computed (`@sfa/shared` `payout-math.ts`), already rounded
 * to the cent, and may be negative, so they are plain numbers — the payout
 * input props (`MONEY_PROP`, which refuses below 0) are for what the owner
 * types.
 *
 * `branchId` is the person's branch when it was computed, as a string like
 * `TenantRecord`'s, so `buildScopeFilter` scopes a branch manager to it. PDF,
 * acceptance and history fields arrive with PAC-181/182.
 */
@Schema({ timestamps: true, collection: 'payStatements' })
export class PayStatement {
  @Prop({ type: String, required: true })
  agencyId: string;

  @Prop({ type: String, default: null })
  branchId: string | null;

  @Prop({ type: String, default: null })
  branchName: string | null;

  @Prop({ type: ObjectIdType, ref: 'PayoutRun', required: true })
  runId: Types.ObjectId;

  /** `YYYY-MM`. */
  @Prop({ type: String, required: true })
  month: string;

  @Prop({ type: ObjectIdType, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true })
  userName: string;

  @Prop({ type: String, default: null })
  allstateBindId: string | null;

  @Prop({ type: [String], default: [] })
  roleNames: string[];

  @Prop({ type: [String], default: [] })
  roleSlugs: string[];

  @Prop({ type: String, enum: PAYOUT_POOLS, required: true })
  pool: PayoutPool;

  @Prop({ type: ObjectIdType, ref: 'PaymentStructure', required: true })
  structureId: Types.ObjectId;

  @Prop({ type: Object, required: true })
  structureSnapshot: StatementStructureSnapshot;

  @Prop({
    type: String,
    enum: PAY_STATEMENT_STATUSES,
    required: true,
    default: 'draft',
  })
  status: PayStatementStatus;

  /** Bumped by each re-send after a dispute (PAC-182). */
  @Prop({ type: Number, required: true, default: 1 })
  version: number;

  @Prop({ type: String, required: true })
  timeZone: string;

  @Prop({ type: [Object], default: [] })
  premiumLines: PremiumLineView[];

  @Prop({ type: [Object], default: [] })
  deals: StatementDealView[];

  @Prop({ type: [Object], default: [] })
  chargebacks: StatementChargebackView[];

  @Prop({ type: Object, required: true })
  bonuses: StatementBonusesView;

  @Prop({ type: Object, required: true })
  indicators: StatementIndicatorsView;

  @Prop({ type: [PayStatementAdjustmentSchema], default: [] })
  adjustments: PayStatementAdjustment[];

  @Prop({ type: Object, required: true })
  totals: StatementTotalsView;

  @Prop({ type: [String], default: [] })
  warnings: string[];

  @Prop({ type: Date, required: true })
  computedAt: Date;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PayStatementSchema = SchemaFactory.createForClass(PayStatement);

/** One statement per person per run — what a recalculation upserts on. */
PayStatementSchema.index(
  { agencyId: 1, runId: 1, userId: 1 },
  { unique: true },
);

/** My Pay: a person's statements, newest month first. */
PayStatementSchema.index({ agencyId: 1, userId: 1, month: -1 });

/** The Payouts table: a month's statements by status. */
PayStatementSchema.index({ agencyId: 1, month: 1, status: 1 });

/** A branch manager's month. */
PayStatementSchema.index({ agencyId: 1, branchId: 1, month: 1 });
