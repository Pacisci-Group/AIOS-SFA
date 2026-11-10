import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  LEAVE_LEDGER_KINDS,
  LEAVE_LEDGER_REASONS,
  LEAVE_LEDGER_SOURCE_KINDS,
  type LeaveLedgerKind,
  type LeaveLedgerReason,
  type LeaveLedgerSourceKind,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type LeaveLedgerDocument = HydratedDocument<LeaveLedger>;

/** What a row came from: the policy, the request or the adjustment behind it. */
@Schema({ _id: false })
export class LeaveLedgerSource {
  @Prop({ type: String, required: true, enum: LEAVE_LEDGER_SOURCE_KINDS })
  kind: LeaveLedgerSourceKind;

  @Prop({ type: ObjectIdType, default: null })
  id: Types.ObjectId | null;
}
export const LeaveLedgerSourceSchema =
  SchemaFactory.createForClass(LeaveLedgerSource);

/**
 * The leave ledger (PAC-148 §7; the collection is PAC-174's, the
 * request-driven rows PAC-165's): one **append-only** row per movement of
 * hours for a person in a time off policy. The balance is never stored — it
 * is the sum of a person's rows in a policy, derived on every read.
 *
 * Nothing updates a row. A mistake is corrected by another row (a
 * `reversal`, a `manual_adjustment`), which is what makes the history
 * trustworthy and a balance explainable.
 *
 * ## Dates
 *
 * `effectiveAt` is an instant: the first moment of the business day the row
 * belongs to, on the agency's calendar (`businessDateInstant`, PAC-159). The
 * accrual job writes the 1st at agency-local midnight; a `used` row (PAC-165)
 * is dated on the leave day.
 *
 * ## Idempotency
 *
 * Rows the job writes carry a `periodKey` (`accrual:2027-03`,
 * `reset:2027-01-01`), and the partial unique index below makes "write the
 * March twelfth for this person" a no-op the second time — a re-run, a
 * retry, a second replica. Hand-written rows (a starting balance, a
 * request) carry `null` and are outside the index. Query it with
 * `periodKey: { $type: 'string' }` or Mongo will not use it.
 *
 * Not a `TenantRecord`: a policy belongs to the agency, not to a branch, and
 * so does its ledger. `agencyId` is a string, the policy convention.
 */
@Schema({ timestamps: true, collection: 'leaveLedger' })
export class LeaveLedger {
  @Prop({ required: true })
  agencyId: string;

  @Prop({ type: ObjectIdType, ref: 'TimeOffPolicy', required: true })
  policyId: Types.ObjectId;

  @Prop({ type: ObjectIdType, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: LEAVE_LEDGER_KINDS })
  kind: LeaveLedgerKind;

  /** Signed, two decimals: allocations add, usage and expiration subtract. */
  @Prop({ type: Number, required: true })
  hours: number;

  @Prop({ type: Date, required: true })
  effectiveAt: Date;

  @Prop({ type: String, default: null })
  periodKey: string | null;

  @Prop({ type: String, enum: [...LEAVE_LEDGER_REASONS, null], default: null })
  reason: LeaveLedgerReason | null;

  @Prop({ type: LeaveLedgerSourceSchema, required: true })
  source: LeaveLedgerSource;

  /** A `reversal`'s link to the `used` row it undoes (PAC-165). */
  @Prop({ type: ObjectIdType, ref: 'LeaveLedger', default: null })
  reversesId: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;

  /** Authorship plugin; null from the worker reads as "system". */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy?: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;
}

export const LeaveLedgerSchema = SchemaFactory.createForClass(LeaveLedger);

/** A person's balance and history in a policy, in date order. */
LeaveLedgerSchema.index({
  agencyId: 1,
  policyId: 1,
  userId: 1,
  effectiveAt: 1,
});

/** The accrual job's idempotency: one row per person, policy, kind and period. */
LeaveLedgerSchema.index(
  { policyId: 1, userId: 1, kind: 1, periodKey: 1 },
  {
    unique: true,
    partialFilterExpression: { periodKey: { $type: 'string' } },
  },
);
