import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ONBOARDING_STEP_KEYS } from '@sfa/shared';
import type { OnboardingStepKey } from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';

export type OnboardingDocument = HydratedDocument<Onboarding>;

/** Things verified once about the client, across the whole onboarding. */
@Schema({ _id: false, timestamps: false })
export class OnboardingChecklist {
  @Prop({ default: false }) mortgageeClauseVerified: boolean;
  @Prop({ default: false }) loanNumberVerified: boolean;
  @Prop({ default: false }) portalAccessVerified: boolean;
  @Prop({ default: false }) rulesOfEngagementSet: boolean;
  /** Asked for during the 30-day call — not a step of its own. */
  @Prop({ default: false }) googleReviewRequested: boolean;
}

export const OnboardingChecklistSchema =
  SchemaFactory.createForClass(OnboardingChecklist);

/**
 * Client touchpoints, stored as the timestamp they were marked (null = not
 * recorded). These are *recorded, never sent* — there is no mailer in the
 * system and none is planned here. Note `day7Sent` has no corresponding call;
 * it is a touchpoint between the 3-day and 30-day check-ins.
 */
@Schema({ _id: false, timestamps: false })
export class OnboardingEmailMilestones {
  @Prop({ type: Date, default: null }) welcomeSent: Date | null;
  @Prop({ type: Date, default: null }) day3Sent: Date | null;
  @Prop({ type: Date, default: null }) day7Sent: Date | null;
  @Prop({ type: Date, default: null }) day30Sent: Date | null;
}

export const OnboardingEmailMilestonesSchema = SchemaFactory.createForClass(
  OnboardingEmailMilestones,
);

/**
 * A client's onboarding journey.
 *
 * Onboarding is tracked **per client**, not per ticket: each of the three calls
 * is its own `ServiceTicket`, and this record is what ties them together and
 * what "the onboarding is complete" refers to. Completing the final call sets
 * `completedAt` here.
 *
 * Tenancy ids are `ObjectId` to match `ServiceTicket` and the rest of this
 * module. `Household` stores them as plain strings, so cast at that boundary.
 */
@Schema({ timestamps: true, collection: 'onboardings' })
export class Onboarding {
  @Prop({ type: Types.ObjectId, ref: 'Agency', required: true, index: true })
  agencyId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Branch', index: true, default: null })
  branchId: Types.ObjectId | null;

  /**
   * The client. Required — an onboarding with no client cannot be tracked per
   * client, which is the whole point of this record.
   */
  @Prop({ type: Types.ObjectId, ref: 'Household', required: true, index: true })
  householdId: Types.ObjectId;

  /** Denormalized so the chain view needs no household read. */
  @Prop({ required: true, trim: true })
  clientName: string;

  /**
   * Client display fields, copied onto every ticket in the chain so each call
   * shows the same context without a lookup. The policy is the one that
   * triggered the onboarding — the onboarding itself is per client, not per
   * policy, but the originating policy is useful context on the call.
   */
  @Prop({ type: Types.ObjectId, ref: 'Policy', default: null })
  policyId: Types.ObjectId | null;

  @Prop({ trim: true, default: '' })
  policyNumber: string;

  @Prop({ trim: true, default: '' })
  policyType: string;

  @Prop({ trim: true, default: '' })
  householdName: string;

  @Prop({ trim: true, default: '' })
  phone: string;

  @Prop({ trim: true, default: '' })
  email: string;

  /** Warm-handoff reference: who sold the policy. */
  @Prop({ trim: true, default: '' })
  salesProducerName: string;

  /** The originating deal. Null for a hand-started onboarding. */
  @Prop({ type: Types.ObjectId, ref: 'Deal', default: null })
  dealId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'DealAudit', default: null })
  dealAuditId: Types.ObjectId | null;

  /** The CSR the chain's tickets are assigned to. */
  @Prop({ type: Types.ObjectId, ref: 'User', index: true, default: null })
  assignedCsrId: Types.ObjectId | null;

  /**
   * Who started the onboarding. Stamped onto every ticket in the chain so the
   * provenance survives the calls that the system opens automatically.
   */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdByUserId: Types.ObjectId | null;

  @Prop({ trim: true, default: '' })
  createdByName: string;

  /** Optional note from whoever started it, used on the first ticket. */
  @Prop({ trim: true, default: '' })
  openingNote: string;

  /**
   * When the engagement began — the deal audit approval. This is the anchor
   * for every `onboarding_start` step, which is what keeps the 30-day check-in
   * from drifting when the earlier calls run late.
   */
  @Prop({ type: Date, required: true })
  startedAt: Date;

  /** The call currently in flight. Null once the onboarding is complete. */
  @Prop({
    type: String,
    enum: ONBOARDING_STEP_KEYS,
    default: ONBOARDING_STEP_KEYS[0],
  })
  currentStepKey: OnboardingStepKey | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  @Prop({ type: OnboardingChecklistSchema, default: () => ({}) })
  checklist: OnboardingChecklist;

  @Prop({ type: OnboardingEmailMilestonesSchema, default: () => ({}) })
  emailMilestones: OnboardingEmailMilestones;
}

export const OnboardingSchema = SchemaFactory.createForClass(Onboarding);

OnboardingSchema.index({ agencyId: 1, householdId: 1, startedAt: -1 });
OnboardingSchema.index({ agencyId: 1, currentStepKey: 1 });

/**
 * One onboarding per deal — the idempotency guarantee for the audit-approval
 * trigger, so a retried approval cannot start a second chain.
 *
 * PARTIAL, not sparse: a sparse index still indexes explicit nulls, and every
 * hand-started onboarding has `dealId: null`. Filtering on `$type: 'objectId'`
 * indexes only the onboardings that actually came from a deal. (Keying on the
 * deal rather than the household is deliberate — a client can onboard again
 * years later for a new policy.)
 */
OnboardingSchema.index(
  { agencyId: 1, dealId: 1 },
  {
    unique: true,
    partialFilterExpression: { dealId: { $type: 'objectId' } },
  },
);
