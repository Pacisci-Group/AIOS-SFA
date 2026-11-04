import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  ACCRUAL_FREQUENCIES,
  ACCRUAL_TYPES,
  COMPENSATIONS,
  RESET_DATE_KINDS,
  TIME_OFF_TYPE_KEYS,
  type AccrualFrequency,
  type AccrualType,
  type Compensation,
  type ResetDateKind,
  type TimeOffTypeKey,
} from '@sfa/shared';
import { HydratedDocument } from 'mongoose';
import { MemberListPolicyRecord } from './policy-record.schema';

export type TimeOffPolicyDocument = HydratedDocument<TimeOffPolicy>;

/** Gusto's two auto-approval rules; both null while `enabled` is false. */
@Schema({ _id: false })
export class TimeOffAutoApproveRow {
  @Prop({ default: false })
  enabled: boolean;

  @Prop({ type: Number, default: null })
  maxCalendarDays: number | null;

  @Prop({ type: Number, default: null })
  minNoticeHours: number | null;
}
export const TimeOffAutoApproveRowSchema = SchemaFactory.createForClass(
  TimeOffAutoApproveRow,
);

/**
 * A Time off policy (PAC-174): one kind of time off — PTO, Sick, Unpaid,
 * Bereavement or Custom — with its accrual model and the people enrolled.
 * The ticket's §4 model, flat, so the payments epic (PAC-123) reads the
 * field names it was given.
 *
 * ## Enrolment is the embedded list, the balance is the ledger
 *
 * `memberIds` is who is in the policy, exactly as on Holiday and Work week
 * (a person is in at most one active policy per `timeOffType`; Custom is
 * exempt; enrolling elsewhere moves them). **No balance is stored here**:
 * a person's balance is the sum of their `leaveLedger` rows in this policy,
 * written at activation / enrolment (the starting balance), by the accrual
 * job and — from PAC-165 — by approved requests.
 *
 * ## Reserved fields
 *
 * `accrualRate`, `accrualRateUnit`, `maxAccruedPerYearHours` and
 * `accrualWaitingPeriodDays` belong to the `hours_worked` accrual type and
 * `per_pay_period` frequency, neither offered until PAC-167 / PAC-123. They
 * are declared so the enum and the document shape need no migration then,
 * and stored null until then.
 *
 * ## Locked
 *
 * `compensation` and `accrualType: 'unlimited'` never change after creation
 * (`HrPoliciesService.update` refuses). Delete and recreate instead.
 */
@Schema({ timestamps: true, collection: 'timeOffPolicies' })
export class TimeOffPolicy extends MemberListPolicyRecord {
  @Prop({ type: String, required: true, enum: TIME_OFF_TYPE_KEYS })
  timeOffType: TimeOffTypeKey;

  @Prop({ type: String, default: null, trim: true })
  description: string | null;

  @Prop({ type: String, required: true, enum: COMPENSATIONS })
  compensation: Compensation;

  @Prop({ type: String, required: true, enum: ACCRUAL_TYPES })
  accrualType: AccrualType;

  @Prop({ type: Number, default: null })
  hoursPerYear: number | null;

  @Prop({ type: String, enum: [...ACCRUAL_FREQUENCIES, null], default: null })
  accrualFrequency: AccrualFrequency | null;

  @Prop({ type: String, enum: [...RESET_DATE_KINDS, null], default: null })
  resetDateKind: ResetDateKind | null;

  /** `MM-DD`, only with `resetDateKind: 'fixed'`. */
  @Prop({ type: String, default: null })
  resetMonthDay: string | null;

  /** Reserved (hours worked). */
  @Prop({ type: Number, default: null })
  accrualRate: number | null;

  /** Reserved (hours worked). */
  @Prop({ type: Number, default: null })
  accrualRateUnit: number | null;

  @Prop({ type: Number, default: null })
  maxBalanceHours: number | null;

  /** Reserved (hours worked). */
  @Prop({ type: Number, default: null })
  maxAccruedPerYearHours: number | null;

  /** `0` = nothing carries over the reset; `null` = everything does. */
  @Prop({ type: Number, default: null })
  carryoverCapHours: number | null;

  /** Sick only. */
  @Prop({ type: Number, default: null })
  annualUsageCapHours: number | null;

  /** Usage waiting period, calendar days after hire. */
  @Prop({ type: Number, default: null })
  waitingPeriodDays: number | null;

  /** Reserved (hours worked). */
  @Prop({ type: Number, default: null })
  accrualWaitingPeriodDays: number | null;

  @Prop({ default: false })
  allowNegativeBalance: boolean;

  /** Stored only; PAC-123 reads it. */
  @Prop({ default: false })
  payOutOnTermination: boolean;

  @Prop({
    type: TimeOffAutoApproveRowSchema,
    default: () => ({
      enabled: false,
      maxCalendarDays: null,
      minNoticeHours: null,
    }),
  })
  autoApprove: TimeOffAutoApproveRow;
}

export const TimeOffPolicySchema = SchemaFactory.createForClass(TimeOffPolicy);

/** The HR policies page's list and counts; the accrual job's per-agency scan. */
TimeOffPolicySchema.index({ agencyId: 1, archivedAt: 1 });

/** "Which time off policies is this person in" — enrolment moves and PAC-165's reads. */
TimeOffPolicySchema.index({ agencyId: 1, memberIds: 1 });
