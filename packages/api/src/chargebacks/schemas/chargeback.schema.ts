import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { CHARGEBACK_REASONS, CHARGEBACK_SOURCES } from '@sfa/shared';
import type { ChargebackReason, ChargebackSource } from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';
import { TenantRecord } from '../../common/schemas/tenant-record.schema';

export type ChargebackDocument = HydratedDocument<Chargeback>;

/**
 * One chargeback event — commission the agency gives back because a policy did
 * not stay on the books.
 *
 * **An append-only ledger, not a running total.** Nothing here is ever edited:
 * the amount, the window verdict and the dates are all stamped at the moment of
 * cancellation, so a later correction to a deal's sold date cannot silently
 * rewrite what a producer was charged three months ago. Reversing a row means
 * writing the reversal, not deleting the row — which is also what makes the
 * ledger reconcilable against a carrier statement when PAC-123 lands.
 *
 * See `domain/chargeback.ts` for why this exists at all ahead of that epic, and
 * for how it differs from ApexReports' per-diem model.
 */
@Schema({ timestamps: true, collection: 'chargebacks' })
export class Chargeback extends TenantRecord {
  /**
   * The policy that went away. The amount is its premium.
   *
   * Indexed because the policy page asks "what did this cost?" — one lookup by
   * policy is the only per-record read path.
   */
  @Prop({ type: ObjectIdType, ref: 'Policy', required: true, index: true })
  policyId: Types.ObjectId;

  /** Denormalized so a ledger row renders without loading a dead policy. */
  @Prop({ trim: true })
  policyNumber?: string;

  @Prop({ trim: true })
  policyType?: string;

  /**
   * The deal the producer was originally credited on — what `soldAdjustment`
   * was applied to. Null for a policy with no deal (migrated, household-only).
   */
  @Prop({ type: ObjectIdType, ref: 'Deal', default: null, index: true })
  dealId: Types.ObjectId | null;

  /** The policy written to replace it. Null if the rewrite wrote none. */
  @Prop({ type: ObjectIdType, ref: 'Policy', default: null })
  replacementPolicyId: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'Household', default: null, index: true })
  householdId: Types.ObjectId | null;

  /**
   * Who carries it: the producer credited on the **original** deal, not whoever
   * recorded the cancellation.
   *
   * That distinction is the whole point of storing it — a CSR processes the
   * rewrite, and charging them for it would be exactly wrong. `createdBy` (from
   * `authorshipPlugin`) records who did the recording.
   */
  @Prop({ type: ObjectIdType, ref: 'User', default: null, index: true })
  producerId: Types.ObjectId | null;

  /** Denormalized at write time; a producer can be deactivated later. */
  @Prop({ trim: true, default: '' })
  producerName: string;

  /*
   * `type: String` is **required** on both of these, not decoration.
   * `ChargebackReason` is a string-literal union, and `@nestjs/mongoose` cannot
   * infer a schema type from one — it throws `CannotDetermineTypeError` at
   * import time, which no typecheck catches because the types are perfectly
   * valid TypeScript. `Deal.businessType` is declared the same way for the same
   * reason.
   */
  @Prop({ type: String, required: true, enum: CHARGEBACK_REASONS })
  reason: ChargebackReason;

  @Prop({
    type: String,
    required: true,
    enum: CHARGEBACK_SOURCES,
    default: 'app',
  })
  source: ChargebackSource;

  /** Always positive — the amount clawed back, never a signed adjustment. */
  @Prop({ required: true, default: 0 })
  amount: number;

  /** `-amount` inside the one-month window, `0` outside it. */
  @Prop({ required: true, default: 0 })
  soldAdjustment: number;

  @Prop({ required: true, default: false })
  withinClawbackWindow: boolean;

  /**
   * When the cancellation was recorded — the date the window was judged on.
   *
   * Separate from `createdAt` deliberately: they are the same instant today, but
   * a backdated cancellation is a real thing a service team needs, and the day
   * the window was measured against must stay legible when it arrives.
   */
  @Prop({ type: Date, required: true, index: true })
  occurredAt: Date;

  /** The sold date the window was measured from, frozen for an auditor. */
  @Prop({ type: Date, default: null })
  soldDate: Date | null;
}

export const ChargebackSchema = SchemaFactory.createForClass(Chargeback);

/**
 * The producer scorecard's read: one producer's chargebacks over a period.
 *
 * `agencyId` leads because every query is tenant-scoped and a cross-tenant scan
 * is the failure that matters; `occurredAt` descending is both the period filter
 * and the order the ledger is shown in.
 */
ChargebackSchema.index({ agencyId: 1, producerId: 1, occurredAt: -1 });

/**
 * One chargeback per policy per rewrite.
 *
 * The rewrite runs in a transaction and its submission token already guards the
 * replay path, but this is the constraint that survives a token that was never
 * sent — a double-submitted rewrite would otherwise charge a producer twice for
 * the same cancellation, which is the one error nobody notices until payroll.
 *
 * Partial rather than plain-unique: `reason` will gain values, and a future
 * carrier-statement row for the same policy is a different fact, not a duplicate.
 */
ChargebackSchema.index(
  { agencyId: 1, policyId: 1, reason: 1 },
  {
    unique: true,
    partialFilterExpression: { reason: 'cancel_rewrite' },
  },
);
