import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  MAX_HAT_TRICK_DEALS,
  MIN_HAT_TRICK_DEALS,
  PAYMENT_STRUCTURE_STATUSES,
} from '@sfa/shared';
import type {
  BonusTier,
  HatTrickRule,
  PaymentStructureStatus,
  RateRule,
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

@Schema({ _id: false })
export class PaymentStructureRateRule implements RateRule {
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
}
const PaymentStructureBonusTierSchema = SchemaFactory.createForClass(
  PaymentStructureBonusTier,
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
