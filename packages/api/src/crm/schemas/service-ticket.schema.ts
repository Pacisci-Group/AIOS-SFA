import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  ONBOARDING_STEP_KEYS,
  RENEWAL_OUTCOMES,
  RENEWAL_STEP_KEYS,
  RENEWAL_TRACKS,
  SERVICE_TICKET_ACTIVITY_TYPES,
  SERVICE_TICKET_CATEGORIES,
  SERVICE_TICKET_PRIORITIES,
  SERVICE_TICKET_STATUSES,
} from '@sfa/shared';
import type {
  OnboardingStepKey,
  RenewalOutcome,
  RenewalStepKey,
  RenewalTrack,
  ServiceTicketActivityType,
  ServiceTicketCategory,
  ServiceTicketPriority,
  ServiceTicketStatus,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';

export type ServiceTicketDocument = HydratedDocument<ServiceTicket>;

/** A single entry in a ticket's activity timeline. */
@Schema({ _id: true, timestamps: false })
export class ServiceTicketActivityEntry {
  @Prop({ type: String, enum: SERVICE_TICKET_ACTIVITY_TYPES, required: true })
  type: ServiceTicketActivityType;

  @Prop({ trim: true })
  author?: string;

  @Prop({ required: true, trim: true })
  content: string;

  @Prop({ type: Date, required: true, default: () => new Date() })
  at: Date;
}

export const ServiceTicketActivitySchema = SchemaFactory.createForClass(
  ServiceTicketActivityEntry,
);

/**
 * The onboarding payload on a ticket: which of the three calls this ticket is,
 * and its timing. **One ticket, one step** — completing it creates the ticket
 * for the next step (see `ServiceTicketsService.completeOnboardingStep`).
 *
 * A step is a *scheduled item*, not a state: it opens at `availableAt`, is due
 * 48h later at `dueAt`, and closes at `completedAt`. The ticket's status is
 * derived from those three fields — see `onboarding-scheduling.ts`.
 *
 * Durable client facts (checklist, email milestones) deliberately live on the
 * parent `Onboarding` record, not here: onboarding is tracked per client, and
 * those facts describe the client rather than any single call.
 */
@Schema({ _id: false, timestamps: false })
export class OnboardingStepEntry {
  /** The parent `Onboarding` this ticket belongs to. */
  @Prop({ type: Types.ObjectId, ref: 'Onboarding', required: true })
  onboardingId: Types.ObjectId;

  @Prop({ type: String, enum: ONBOARDING_STEP_KEYS, required: true })
  stepKey: OnboardingStepKey;

  /** 1-based position in the chain, for "Step 2 of 3". */
  @Prop({ required: true, default: 1 })
  sequence: number;

  /**
   * When this call opens for work. A ticket whose `availableAt` is still in the
   * future is hidden from every list — it is scheduled, not yet on the plate.
   */
  @Prop({ type: Date, default: null })
  availableAt: Date | null;

  @Prop({ type: Date, default: null })
  dueAt: Date | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  completedBy: Types.ObjectId | null;

  /** Denormalized display name, so the panel needs no user lookup. */
  @Prop({ trim: true, default: '' })
  completedByName: string;
}

export const OnboardingStepSchema =
  SchemaFactory.createForClass(OnboardingStepEntry);

/**
 * This ticket's renewal-outreach call: which of the cycle's calls it is, and
 * its timing. Structurally parallel to `OnboardingStepEntry` on purpose, so the
 * ticket feed and the urgency sort can treat either as "the scheduled step this
 * ticket carries" without knowing which kind it is.
 *
 * Unlike onboarding, the calls do **not** chain — each is anchored
 * independently to the carrier's renewal date, so both tickets exist from the
 * moment the cycle is created (see `renewal-scheduling.ts` for why).
 *
 * The policy checklist and the renewal decision live on the parent
 * `RenewalCycle`: they describe the deal, not one call.
 */
@Schema({ _id: false, timestamps: false })
export class RenewalStepEntry {
  /** The parent `RenewalCycle` this ticket belongs to. */
  @Prop({ type: Types.ObjectId, ref: 'RenewalCycle', required: true })
  renewalCycleId: Types.ObjectId;

  @Prop({ type: String, enum: RENEWAL_STEP_KEYS, required: true })
  stepKey: RenewalStepKey;

  @Prop({ type: String, enum: RENEWAL_TRACKS, required: true })
  track: RenewalTrack;

  /** 1-based position, for "Step 1 of 2". */
  @Prop({ required: true, default: 1 })
  sequence: number;

  /**
   * How many calls this cycle has — **1 on the auto track, 2 otherwise**.
   * Stored rather than derived from a constant, unlike onboarding's
   * `ONBOARDING_STEP_KEYS.length`, because it varies by track.
   */
  @Prop({ required: true, default: 1 })
  totalSteps: number;

  /** Denormalized so the desk and feed row need no parent read. */
  @Prop({ type: Date, required: true })
  renewalDate: Date;

  @Prop({ type: Date, default: null })
  availableAt: Date | null;

  @Prop({ type: Date, default: null })
  dueAt: Date | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  completedBy: Types.ObjectId | null;

  @Prop({ trim: true, default: '' })
  completedByName: string;

  /**
   * The renewal decision. Only ever set on a `renewal_review` step — the
   * 90-day annual review has no decision to record.
   */
  @Prop({ type: String, enum: RENEWAL_OUTCOMES, default: null })
  outcome: RenewalOutcome | null;

  @Prop({ type: Date, default: null })
  outcomeAt: Date | null;
}

export const RenewalStepSchema = SchemaFactory.createForClass(RenewalStepEntry);

@Schema({ timestamps: true, collection: 'service_tickets' })
export class ServiceTicket {
  @Prop({ type: Types.ObjectId, ref: 'Agency', required: true, index: true })
  agencyId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Branch', index: true, default: null })
  branchId?: Types.ObjectId | null;

  /** Human-facing ticket reference, unique within an agency (e.g. RENEW-280). */
  @Prop({ required: true, trim: true })
  ticketNumber: string;

  @Prop({ required: true, trim: true })
  clientName: string;

  @Prop({ type: String, enum: SERVICE_TICKET_CATEGORIES, required: true })
  category: ServiceTicketCategory;

  @Prop({
    type: String,
    enum: SERVICE_TICKET_STATUSES,
    required: true,
    default: 'open',
  })
  status: ServiceTicketStatus;

  /**
   * When a human last set `status` by hand on an *onboarding* ticket, or null
   * while its status is still derived from the call schedule.
   *
   * Onboarding status normally comes from step timing (`waiting -> open ->
   * overdue`), which has no write to hang an update off. A CSR can still
   * override it from the status picker like any other ticket; this marks that
   * the stored `status` is now the authoritative one. Completing the call
   * clears it, handing the ticket back to the schedule.
   *
   * Always null for every other category — their status is stored, never
   * derived, so there is nothing to override.
   */
  @Prop({ type: Date, default: null })
  statusOverriddenAt?: Date | null;

  @Prop({
    type: String,
    enum: SERVICE_TICKET_PRIORITIES,
    required: true,
    default: 'medium',
  })
  priority: ServiceTicketPriority;

  /** Denormalized display name of the assigned rep. */
  @Prop({ trim: true, default: '' })
  assignedRep: string;

  /** The user this ticket belongs to (drives `own` data-scope filtering). */
  @Prop({ type: Types.ObjectId, ref: 'User', index: true, default: null })
  assignedUserId?: Types.ObjectId | null;

  /** Who opened the ticket. Stamped from the caller, never client-supplied. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdByUserId?: Types.ObjectId | null;

  @Prop({ trim: true, default: '' })
  createdByName: string;

  @Prop({ trim: true, default: '' })
  policyNumber: string;

  @Prop({ trim: true, default: '' })
  policyType: string;

  @Prop({ trim: true, default: '' })
  household: string;

  /**
   * Links to the real client records. The denormalized `policyNumber` /
   * `policyType` / `household` strings above stay as the display fallback for
   * tickets that have no linked record.
   */
  @Prop({ type: Types.ObjectId, ref: 'Policy', index: true, default: null })
  policyId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Household', index: true, default: null })
  householdId: Types.ObjectId | null;

  /**
   * The lead this ticket was opened for — set only on `Quote` tickets, which
   * "Start Quote" creates alongside the lead itself.
   *
   * This is the one link that changes how the ticket *behaves* rather than just
   * what it displays: a ticket with a `leadId` has no status of its own.
   * `updateStatus` refuses to write one, and the ticket resolves when the lead
   * reaches a terminal status (`LeadTicketsService.resolveForLead`). That is
   * the point — a quote's service work is finished exactly when the quote is,
   * and letting the two disagree is what this prevents.
   */
  @Prop({ type: Types.ObjectId, ref: 'Lead', index: true, default: null })
  leadId: Types.ObjectId | null;

  @Prop({ trim: true, default: '' })
  phone: string;

  @Prop({ trim: true, default: '' })
  email: string;

  @Prop({ type: Date, required: true, default: () => new Date() })
  openedAt: Date;

  @Prop({ type: Date, required: true, default: () => new Date() })
  lastActivityAt: Date;

  /**
   * When the ticket most recently entered `resolved`. Cleared whenever it is
   * reopened. Drives the 7-day archive window.
   */
  @Prop({ type: Date, default: null })
  resolvedAt?: Date | null;

  @Prop({ type: [ServiceTicketActivitySchema], default: [] })
  timeline: ServiceTicketActivityEntry[];

  /**
   * This ticket's onboarding step. Null for every category except
   * `Onboarding` — the only category-specific payload on a ticket.
   */
  @Prop({ type: OnboardingStepSchema, default: null })
  onboarding: OnboardingStepEntry | null;

  /**
   * This ticket's renewal-outreach call, or null for everything else. A ticket
   * never carries both this and `onboarding` — they are the two kinds of
   * scheduled step, and a ticket is one call of one kind.
   */
  @Prop({ type: RenewalStepSchema, default: null })
  renewal: RenewalStepEntry | null;

  @Prop()
  legacySmartSuiteId?: string;
}

export const ServiceTicketSchema = SchemaFactory.createForClass(ServiceTicket);
ServiceTicketSchema.index({ agencyId: 1, ticketNumber: 1 }, { unique: true });
ServiceTicketSchema.index({ agencyId: 1, branchId: 1, status: 1 });
ServiceTicketSchema.index({ assignedUserId: 1, status: 1 });
ServiceTicketSchema.index({ agencyId: 1, status: 1, resolvedAt: 1 });

// One quote ticket per lead, ever. This is the idempotency guard for
// `LeadTicketsService.ensureForLead`, which the Start Quote dialog calls on
// every run — including when the producer picks a lead that already has one.
//
// PARTIAL, not sparse, for the same reason spelled out on the onboarding index
// below: a sparse index still indexes explicit nulls, and every ticket that is
// not a quote carries `leadId: null`, so a sparse index would collide them all
// on the first pair. Filtering on `$type: 'objectId'` indexes only real quote
// tickets.
ServiceTicketSchema.index(
  { agencyId: 1, leadId: 1 },
  {
    unique: true,
    partialFilterExpression: { leadId: { $type: 'objectId' } },
  },
);

// Onboarding status is derived from step timing rather than the `status`
// field, so the queue filters on these instead. `availableAt` also drives the
// hidden-until-it-opens exclusion applied to every list.
ServiceTicketSchema.index({
  agencyId: 1,
  category: 1,
  'onboarding.availableAt': 1,
});
ServiceTicketSchema.index({
  agencyId: 1,
  category: 1,
  'onboarding.dueAt': 1,
});
// Every ticket in a client's chain, for the "Step 2 of 3" view.
ServiceTicketSchema.index({
  'onboarding.onboardingId': 1,
  'onboarding.sequence': 1,
});

// One ticket per step per onboarding. This is the idempotency guard for
// chained creation: completing a call twice, or a retried write, cannot
// produce two tickets for the next step.
//
// PARTIAL, not sparse: a sparse index still indexes explicit nulls, and
// Mongoose materializes the nested path on every ticket — which is exactly how
// the previous `onboarding.dealId` index made all non-onboarding tickets
// collide on `{ dealId: null }`. Filtering on `$type: 'objectId'` indexes only
// real onboarding tickets.
ServiceTicketSchema.index(
  { agencyId: 1, 'onboarding.onboardingId': 1, 'onboarding.stepKey': 1 },
  {
    unique: true,
    partialFilterExpression: {
      'onboarding.onboardingId': { $type: 'objectId' },
    },
  },
);

// Renewal outreach, mirroring the onboarding indexes above. `availableAt`
// drives the hidden-until-it-opens exclusion; `dueAt` drives the overdue
// derivation and the desk's urgency ordering.
ServiceTicketSchema.index({ agencyId: 1, 'renewal.availableAt': 1 });
ServiceTicketSchema.index({ agencyId: 1, 'renewal.dueAt': 1 });
// Both calls of one cycle, for the chain view.
ServiceTicketSchema.index({
  'renewal.renewalCycleId': 1,
  'renewal.sequence': 1,
});
// One ticket per call per cycle — the idempotency guard for materialization,
// which runs on every desk read. PARTIAL for the same reason as the onboarding
// index above: a sparse index still indexes explicit nulls, and Mongoose
// materializes the nested path on every ticket.
ServiceTicketSchema.index(
  { agencyId: 1, 'renewal.renewalCycleId': 1, 'renewal.stepKey': 1 },
  {
    unique: true,
    partialFilterExpression: {
      'renewal.renewalCycleId': { $type: 'objectId' },
    },
  },
);
