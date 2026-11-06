import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  ANY_CARRIER,
  MAX_HAT_TRICK_DEALS,
  MIN_HAT_TRICK_DEALS,
  OVERRIDE_BASES,
  PAYMENT_STRUCTURE_STATUSES,
  RATE_STEP_BASES,
} from '@sfa/shared';
import type {
  BonusTier,
  HatTrickRule,
  OverrideBasis,
  PaymentStructureStatus,
  RateStepBasis,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';
import {
  MONEY_PROP,
  NULLABLE_PERCENT_PROP,
  PERCENT_PROP,
  WHOLE_NUMBER,
} from '../../common/payouts/stored-amounts';

export type PaymentStructureDocument = HydratedDocument<PaymentStructure>;

/*
 * The number rules below are the shared validators' again (see
 * `common/payouts/stored-amounts.ts`). Update paths pass
 * `runValidators: true` so they hold on `findOneAndUpdate` as well as on
 * `create`.
 */

/** One step of a stepped rate (`RateStep` in `@sfa/shared`). */
@Schema({ _id: false })
export class PaymentStructureRateStep {
  /** Dollars of premium, or a retention percentage — the rule's `stepBasis`. */
  @Prop({ ...MONEY_PROP, required: true })
  threshold: number;

  @Prop({ ...PERCENT_PROP, required: true })
  ratePercent: number;

  @Prop({ ...MONEY_PROP, default: 0 })
  bonusAmount: number;

  @Prop(NULLABLE_PERCENT_PROP)
  minCompliancePercent: number | null;

  @Prop(NULLABLE_PERCENT_PROP)
  minBundleRatePercent: number | null;
}
const PaymentStructureRateStepSchema = SchemaFactory.createForClass(
  PaymentStructureRateStep,
);

@Schema({ _id: false })
export class PaymentStructureRateRule {
  /** A carrier's display name, or `ANY_CARRIER` (`*`). */
  @Prop({ type: String, required: true, trim: true })
  carrier: string;

  @Prop({ ...PERCENT_PROP, required: true })
  ratePercent: number;

  /**
   * The bundle rate the person must keep on this carrier's sales; `null`
   * when not enforced. Missing it flags the statement and changes no pay.
   */
  @Prop(NULLABLE_PERCENT_PROP)
  minBundleRatePercent: number | null;

  /** What `steps` are measured on. Absent on rules saved before steps. */
  @Prop({ type: String, enum: RATE_STEP_BASES, default: 'premium' })
  stepBasis: RateStepBasis;

  /** Lowest threshold first; `[]` = a flat rate. */
  @Prop({ type: [PaymentStructureRateStepSchema], default: [] })
  steps: PaymentStructureRateStep[];
}
const PaymentStructureRateRuleSchema = SchemaFactory.createForClass(
  PaymentStructureRateRule,
);

/**
 * A lead-source rate override (`LeadSourceRateRule` in `@sfa/shared`): sales
 * from `leadSourceId` are paid `ratePercent` instead of the carrier rate.
 * The source is referenced, never named — its name is resolved on read
 * through `LeadSourcesService.labelsFor`.
 */
@Schema({ _id: false })
export class PaymentStructureLeadSourceRule {
  /** The agency's own `leadSources` row or a platform one. */
  @Prop({ type: ObjectIdType, ref: 'LeadSource', required: true })
  leadSourceId: Types.ObjectId;

  /** A carrier's display name, or `ANY_CARRIER` (`*`) for every carrier. */
  @Prop({ type: String, required: true, trim: true })
  carrier: string;

  @Prop({ ...PERCENT_PROP, required: true })
  ratePercent: number;
}
const PaymentStructureLeadSourceRuleSchema = SchemaFactory.createForClass(
  PaymentStructureLeadSourceRule,
);

@Schema({ _id: false })
export class PaymentStructureHatTrick implements HatTrickRule {
  @Prop({ type: Boolean, required: true })
  enabled: boolean;

  @Prop({
    type: Number,
    required: true,
    min: MIN_HAT_TRICK_DEALS,
    max: MAX_HAT_TRICK_DEALS,
    validate: WHOLE_NUMBER,
  })
  dealsPerDay: number;

  @Prop({ ...MONEY_PROP, required: true })
  bonusAmount: number;
}
const PaymentStructureHatTrickSchema = SchemaFactory.createForClass(
  PaymentStructureHatTrick,
);

@Schema({ _id: false })
export class PaymentStructureBonusTier implements BonusTier {
  @Prop({ ...MONEY_PROP, required: true })
  thresholdPremium: number;

  @Prop({ ...MONEY_PROP, required: true })
  bonusAmount: number;

  /** Monthly tiers only: the tier needs an entered compliance rate this high. */
  @Prop(NULLABLE_PERCENT_PROP)
  minCompliancePercent: number | null;
}
const PaymentStructureBonusTierSchema = SchemaFactory.createForClass(
  PaymentStructureBonusTier,
);

@Schema({ _id: false })
export class PaymentStructureComplianceFloor {
  @Prop({ ...PERCENT_PROP, required: true })
  minimumPercent: number;

  @Prop({ ...PERCENT_PROP, required: true })
  reductionPercent: number;
}
const PaymentStructureComplianceFloorSchema = SchemaFactory.createForClass(
  PaymentStructureComplianceFloor,
);

/** Pay on premium other people sold (`OverrideRule` in `@sfa/shared`). */
@Schema({ _id: false })
export class PaymentStructureOverride {
  @Prop({ type: String, enum: OVERRIDE_BASES, required: true })
  basis: OverrideBasis;

  /** The lead source of a `lead_source` override; `null` for `agency`. */
  @Prop({ type: ObjectIdType, ref: 'LeadSource', default: null })
  leadSourceId: Types.ObjectId | null;

  @Prop({ type: String, required: true, trim: true })
  carrier: string;

  @Prop({ ...PERCENT_PROP, required: true })
  ratePercent: number;
}
const PaymentStructureOverrideSchema = SchemaFactory.createForClass(
  PaymentStructureOverride,
);

@Schema({ _id: false })
export class PaymentStructureTeamRequirements {
  @Prop({ type: Number, min: 0, max: 31, default: null })
  soldLogWithinDays: number | null;

  @Prop({ type: Boolean, default: false })
  meetingAttendance: boolean;
}
const PaymentStructureTeamRequirementsSchema = SchemaFactory.createForClass(
  PaymentStructureTeamRequirements,
);

@Schema({ _id: false })
export class PaymentStructureReferralRule {
  @Prop({ type: Number, required: true, min: 0, validate: WHOLE_NUMBER })
  minimum: number;

  @Prop({ ...MONEY_PROP, required: true })
  shortfallDeduction: number;

  @Prop({ type: Number, min: 1, default: null })
  bonusThreshold: number | null;

  @Prop({ ...MONEY_PROP, required: true })
  bonusAmount: number;
}
const PaymentStructureReferralRuleSchema = SchemaFactory.createForClass(
  PaymentStructureReferralRule,
);

/** When a member started — month 1 of the stipend. */
@Schema({ _id: false })
export class PaymentStructureMemberStart {
  @Prop({ type: ObjectIdType, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** `YYYY-MM`. */
  @Prop({ type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ })
  startMonth: string;
}
const PaymentStructureMemberStartSchema = SchemaFactory.createForClass(
  PaymentStructureMemberStart,
);

/**
 * A payment structure (PAC-177): how the people on it are paid each month.
 * The rules are documented in `@sfa/shared` `domain/payouts.ts`; this is
 * their storage.
 *
 * **Not a `TenantRecord`.** A structure belongs to the agency, not to a
 * branch — the HR policies (PAC-161) made the same call — so it carries
 * `agencyId` and no `branchId`. It declares `createdBy` / `updatedBy` itself,
 * which is all `authorshipPlugin` looks for.
 *
 * ## Members
 *
 * `memberIds` is embedded: an agency is tens of people, the list is read
 * whole every time it is shown, and "which structure is this person on" is a
 * multikey lookup on the same field. A person is on **at most one active
 * structure**; the service enforces it by moving them (a save `$pull`s its
 * members from every other active structure in the same transaction, which
 * first bumps `Agency.payoutStructuresRevision` so concurrent saves in one
 * agency serialise instead of both keeping the person).
 *
 * A member who is later removed from the agency **stays** on the list: their
 * last month still has to be paid, and the statement for it is drafted from
 * this list. Readers count and show them as removed.
 *
 * ## Archive, never delete
 *
 * Archiving sets `status: 'archived'` and empties `memberIds` (the people are
 * free to join another structure). Statements keep a snapshot of the rules
 * they were computed with, so an archived structure is history, not a
 * dependency.
 */
@Schema({ timestamps: true, collection: 'paymentStructures' })
export class PaymentStructure {
  /** A string, the `TenantRecord` convention — unlike `User.agencyId`. */
  @Prop({ type: String, required: true })
  agencyId: string;

  @Prop({ type: String, required: true, trim: true })
  name: string;

  /**
   * `name` trimmed, lower-cased and with runs of whitespace collapsed: what
   * the one-active-name-per-agency index compares, so "Senior  Producers"
   * and "senior producers" collide.
   */
  @Prop({ type: String, required: true })
  nameKey: string;

  @Prop({
    type: String,
    enum: PAYMENT_STRUCTURE_STATUSES,
    required: true,
    default: 'active',
  })
  status: PaymentStructureStatus;

  /** Carriers by name, the "any other carrier" rule last. */
  @Prop({ type: [PaymentStructureRateRuleSchema], default: [] })
  rules: PaymentStructureRateRule[];

  /**
   * Overrides of `rules` for sales from particular lead sources — they
   * replace the carrier rate, and change nothing else. Grouped by source id,
   * then carriers by name with "any carrier" last
   * (`normalizeLeadSourceRules`). Usually empty.
   */
  @Prop({ type: [PaymentStructureLeadSourceRuleSchema], default: [] })
  leadSourceRules: PaymentStructureLeadSourceRule[];

  @Prop({ type: PaymentStructureHatTrickSchema, required: true })
  hatTrick: PaymentStructureHatTrick;

  /** Lowest threshold first. */
  @Prop({ type: [PaymentStructureBonusTierSchema], default: [] })
  individualTiers: PaymentStructureBonusTier[];

  /** Every tier reached pays, added up — rather than only the highest. */
  @Prop({ type: Boolean, required: true, default: false })
  tiersStackable: boolean;

  @Prop({ type: Boolean, required: true, default: true })
  teamBonusEligible: boolean;

  // ── The 2026 comp-plan parts (6 Nov 2026) ────────────────────────────
  // Every one defaults to "none"; reads still null-guard them, because a
  // structure saved before they existed has none of the fields at all.

  /** Monthly base pay on every member's statement. */
  @Prop({ ...MONEY_PROP, default: 0 })
  basePay: number;

  /** The stipend for months 1, 2, … of a member's start. */
  @Prop({ type: [Number], default: [] })
  stipendAmounts: number[];

  /** Members' start months (for the stipend); kept to current members. */
  @Prop({ type: [PaymentStructureMemberStartSchema], default: [] })
  memberStarts: PaymentStructureMemberStart[];

  @Prop({ type: PaymentStructureComplianceFloorSchema, default: null })
  complianceFloor: PaymentStructureComplianceFloor | null;

  @Prop({ type: [PaymentStructureOverrideSchema], default: [] })
  overrides: PaymentStructureOverride[];

  /** A personal bonus on the agency's premium on `agencyTiersCarrier`. */
  @Prop({ type: [PaymentStructureBonusTierSchema], default: [] })
  agencyTiers: PaymentStructureBonusTier[];

  @Prop({ type: String, default: ANY_CARRIER, trim: true })
  agencyTiersCarrier: string;

  @Prop({ type: PaymentStructureTeamRequirementsSchema, default: null })
  teamRequirements: PaymentStructureTeamRequirements | null;

  @Prop({ type: PaymentStructureReferralRuleSchema, default: null })
  referralRule: PaymentStructureReferralRule | null;

  @Prop({ type: Number, min: 1, max: 36, default: null })
  chargebackWindowMonths: number | null;

  @Prop({ type: [ObjectIdType], ref: 'User', default: [] })
  memberIds: Types.ObjectId[];

  @Prop({ type: Date, default: null })
  archivedAt: Date | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  archivedBy: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy?: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;
}

export const PaymentStructureSchema =
  SchemaFactory.createForClass(PaymentStructure);

/** The settings page lists the agency's active structures by name. */
PaymentStructureSchema.index({ agencyId: 1, status: 1, name: 1 });

/** "Which structure is this person on" — the move-on-save and the people step. */
PaymentStructureSchema.index({ agencyId: 1, memberIds: 1 });

/**
 * One active structure per name per agency. Partial on `status` so an
 * archived "Producers" does not block a new one; the service checks first
 * and answers 409, and this is what holds under a race.
 */
PaymentStructureSchema.index(
  { agencyId: 1, nameKey: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);

/** The comparison key for {@link PaymentStructure.nameKey}. */
export function paymentStructureNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
