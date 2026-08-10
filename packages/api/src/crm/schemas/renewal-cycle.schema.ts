import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  RENEWAL_CLOSED_REASONS,
  RENEWAL_OUTCOMES,
  RENEWAL_STEP_KEYS,
  RENEWAL_TRACKS,
} from '@sfa/shared';
import type {
  RenewalClosedReason,
  RenewalOutcome,
  RenewalStepKey,
  RenewalTrack,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';

export type RenewalCycleDocument = HydratedDocument<RenewalCycle>;

/**
 * One policy on the cycle's checklist.
 *
 * The CSR makes **one call for the whole deal**, so the checklist is what stops
 * a policy being skipped in the conversation. Ticking a line records that it
 * was discussed — the renewal *decision* is recorded once for the cycle, not
 * per policy.
 */
@Schema({ _id: false, timestamps: false })
export class RenewalPolicyEntry {
  @Prop({ type: Types.ObjectId, ref: 'Policy', required: true })
  policyId: Types.ObjectId;

  @Prop({ trim: true, default: '' })
  policyNumber: string;

  @Prop({ trim: true, default: '' })
  policyType: string;

  @Prop({ trim: true, default: '' })
  carrier: string;

  @Prop({ default: 0 })
  premium: number;

  /** This policy's own renewal date, which may differ slightly from the anchor. */
  @Prop({ type: Date, default: null })
  renewalDate: Date | null;

  @Prop({ type: Date, default: null })
  discussedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  discussedBy: Types.ObjectId | null;

  @Prop({ trim: true, default: '' })
  discussedByName: string;
}

export const RenewalPolicySchema =
  SchemaFactory.createForClass(RenewalPolicyEntry);

/**
 * One deal's renewal outreach for one term.
 *
 * This — not any single ticket — is what "the renewal" means: the policy
 * checklist and the outcome live here, and the one or two call tickets hang off
 * it. Directly mirrors `Onboarding`, which plays the same role for its chain.
 *
 * Tenancy ids are `ObjectId` to match `ServiceTicket` and `Onboarding`.
 * `Policy` and `Household` store them as plain **strings**, so cast at that
 * boundary — getting it wrong returns zero documents silently rather than
 * erroring.
 */
@Schema({ timestamps: true, collection: 'renewalCycles' })
export class RenewalCycle {
  @Prop({ type: Types.ObjectId, ref: 'Agency', required: true, index: true })
  agencyId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Branch', index: true, default: null })
  branchId?: Types.ObjectId | null;

  /**
   * What the outreach is grouped by: `deal:<id>`, or `household:<id>` for
   * policies with no deal. One string rather than two nullable ids, so the
   * unique index below can be plain rather than partial and every lookup takes
   * the same code path.
   */
  @Prop({ required: true, trim: true })
  groupKey: string;

  @Prop({ type: Types.ObjectId, ref: 'Deal', default: null })
  dealId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Household', index: true, default: null })
  householdId: Types.ObjectId | null;

  /**
   * The cycle's identity: UTC `yyyy-mm-dd` of the anchor renewal date **at
   * creation**, never rewritten. Next term's renewal is a different key and so
   * a different cycle, while a carrier nudging the date by a few days stays
   * this one.
   */
  @Prop({ required: true, trim: true })
  termKey: string;

  /** The current anchor. Can drift from `termKey` when a carrier moves it. */
  @Prop({ type: Date, required: true })
  renewalDate: Date;

  @Prop({ type: String, enum: RENEWAL_TRACKS, required: true })
  track: RenewalTrack;

  /** Every policy renewing in this cycle — the call's checklist. */
  @Prop({ type: [RenewalPolicySchema], default: [] })
  policies: RenewalPolicyEntry[];

  /* Denormalized display, copied onto every ticket so a call shows its client
   * context without a lookup. Same rationale as `Onboarding`. */

  @Prop({ trim: true, default: '' })
  clientName: string;

  @Prop({ trim: true, default: '' })
  householdName: string;

  @Prop({ trim: true, default: '' })
  phone: string;

  @Prop({ trim: true, default: '' })
  email: string;

  /* State, maintained by `reconcileRenewalCycle`. */

  @Prop({
    type: String,
    enum: RENEWAL_STEP_KEYS,
    default: null,
  })
  currentStepKey: RenewalStepKey | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  @Prop({ type: String, enum: RENEWAL_CLOSED_REASONS, default: null })
  closedReason: RenewalClosedReason | null;

  /**
   * Roll-up of the `renewal_review` ticket's outcome. Authoritative copy lives
   * on the ticket; this mirror exists so stats can query one indexed collection
   * instead of scanning tickets.
   */
  @Prop({ type: String, enum: RENEWAL_OUTCOMES, default: null })
  outcome: RenewalOutcome | null;

  @Prop({ type: Date, default: null })
  outcomeAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  outcomeBy: Types.ObjectId | null;

  @Prop({ trim: true, default: '' })
  outcomeByName: string;

  @Prop({ trim: true, default: '' })
  outcomeNote: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  assignedCsrId: Types.ObjectId | null;
}

export const RenewalCycleSchema = SchemaFactory.createForClass(RenewalCycle);

// One cycle per group per term. PLAIN unique, not partial: unlike
// `Onboarding.dealId` — which is nullable, and so needed a partial filter to
// stop every hand-started onboarding colliding on null — `groupKey` and
// `termKey` are both required and always present.
RenewalCycleSchema.index(
  { agencyId: 1, groupKey: 1, termKey: 1 },
  { unique: true },
);

// The open-cycle sweep and the "renewals this month" KPI.
RenewalCycleSchema.index({ agencyId: 1, completedAt: 1, renewalDate: 1 });

// Outcome reporting (took the renewal vs shopping around).
RenewalCycleSchema.index({ agencyId: 1, outcome: 1, outcomeAt: -1 });
