import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  PAYOUT_POOLS,
  PAYOUT_RUN_STATUSES,
  PAYOUT_RUN_TRIGGERS,
  type PayoutPool,
  type PayoutRunStatus,
  type PayoutRunTeamBonusView,
  type PayoutRunTrigger,
  type PayoutSettingsView,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type PayoutRunDocument = HydratedDocument<PayoutRun>;

/** One person's part of the month's team pool, as the last full calculation split it. */
@Schema({ _id: false })
export class PayoutRunTeamShare {
  @Prop({ type: ObjectIdType, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: PAYOUT_POOLS, required: true })
  pool: PayoutPool;

  @Prop({ type: Number, required: true })
  grossPremium: number;

  @Prop({ type: Boolean, required: true })
  eligible: boolean;

  @Prop({ type: Number, required: true })
  share: number;
}
const PayoutRunTeamShareSchema =
  SchemaFactory.createForClass(PayoutRunTeamShare);

@Schema({ _id: false })
export class PayoutRunWindow {
  @Prop({ type: Date, required: true })
  from: Date;

  /** Exclusive: the next month's first instant. */
  @Prop({ type: Date, required: true })
  to: Date;
}
const PayoutRunWindowSchema = SchemaFactory.createForClass(PayoutRunWindow);

/** Salesperson of the Month as the last full calculation decided it. */
export interface PayoutRunSalespersonOfMonth {
  enabled: boolean;
  bonusAmount: number;
  topGrossPremium: number | null;
  winners: { userId: string; name: string }[];
}

/**
 * One agency's pay month (PAC-178): the job — or the owner's Generate —
 * that drafts its statements, and the agency-wide facts they share.
 *
 * ## The claim
 *
 * `{agencyId, month}` is unique, and the upsert that creates the row is how
 * a generation is claimed: only the caller whose upsert inserted it, or
 * whose conditional update took a `failed` / stale `generating` / finished
 * run over (`common/payouts/run-claim.ts`), computes. The hourly job and a
 * Generate pressed at the same moment therefore never compute one month
 * twice at once.
 *
 * ## What is stored
 *
 * The month's window and zone as they were when it ran (a later change to
 * the agency's zone does not move a computed month), the settings it used,
 * the agency's gross premium against the team levels, the pools and every
 * member's share — so recalculating **one** statement reuses the split the
 * others were paid on instead of re-splitting a pool already shown to people
 * — and Salesperson of the Month.
 *
 * Counts and totals are **not** stored: they are read over the statements the
 * caller may see, so a branch manager is never shown the agency's payroll.
 *
 * Agency-wide and branch-less — the `ReconciliationRun` pattern.
 */
@Schema({ timestamps: true, collection: 'payoutRuns' })
export class PayoutRun {
  @Prop({ type: String, required: true })
  agencyId: string;

  /** `YYYY-MM` on the agency's calendar. */
  @Prop({ type: String, required: true })
  month: string;

  @Prop({ type: String, enum: PAYOUT_RUN_STATUSES, required: true })
  status: PayoutRunStatus;

  /** Who started the latest generation: the 1st-of-month job or the owner. */
  @Prop({ type: String, enum: PAYOUT_RUN_TRIGGERS, required: true })
  trigger: PayoutRunTrigger;

  @Prop({ type: String, required: true })
  timeZone: string;

  @Prop({ type: PayoutRunWindowSchema, required: true })
  window: PayoutRunWindow;

  /** The latest generation's start; a `generating` run older than the stale limit is dead. */
  @Prop({ type: Date, required: true })
  startedAt: Date;

  @Prop({ type: Date, default: null })
  finishedAt: Date | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  generatedBy: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  error: string | null;

  @Prop({ type: Object, default: null })
  settingsSnapshot: PayoutSettingsView | null;

  @Prop({ type: Number, default: 0 })
  agencyGrossPremium: number;

  @Prop({ type: Object, default: null })
  teamBonus: PayoutRunTeamBonusView | null;

  @Prop({ type: [PayoutRunTeamShareSchema], default: [] })
  teamShares: PayoutRunTeamShare[];

  @Prop({ type: Object, default: null })
  salespersonOfMonth: PayoutRunSalespersonOfMonth | null;

  @Prop({ type: [String], default: [] })
  warnings: string[];

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PayoutRunSchema = SchemaFactory.createForClass(PayoutRun);

/** One run per agency and month — the claim. */
PayoutRunSchema.index({ agencyId: 1, month: 1 }, { unique: true });
