import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ONBOARDING_STEP_ANCHORS, ONBOARDING_STEP_KEYS } from '@sfa/shared';
import type { OnboardingStepAnchor, OnboardingStepKey } from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';

export type OnboardingStepDefinitionDocument =
  HydratedDocument<OnboardingStepDefinitionRecord>;

/**
 * Per-agency timing config for onboarding steps — the catalog that drives the
 * step rows written onto each onboarding ticket.
 *
 * Timing lives here rather than in code so an agency can retune its cadence
 * without a deploy. Shape mirrors `auditTemplates`, the existing definition
 * catalog. Seeded from `DEFAULT_ONBOARDING_STEP_DEFINITIONS`.
 *
 * Tenancy ids are `ObjectId` to match `ServiceTicket` (and the rest of this
 * module) — note that `TenantRecord`-based collections use plain strings.
 */
@Schema({ timestamps: true, collection: 'onboardingStepDefinitions' })
export class OnboardingStepDefinitionRecord {
  @Prop({ type: Types.ObjectId, ref: 'Agency', required: true, index: true })
  agencyId: Types.ObjectId;

  @Prop({ type: String, enum: ONBOARDING_STEP_KEYS, required: true })
  stepKey: OnboardingStepKey;

  @Prop({ required: true, default: 0 })
  sortOrder: number;

  @Prop({
    type: String,
    enum: ONBOARDING_STEP_ANCHORS,
    required: true,
    default: 'previous_step',
  })
  anchor: OnboardingStepAnchor;

  /** Added to the anchor time before the step becomes available. */
  @Prop({ required: true, default: 0 })
  offsetMinutes: number;

  /** How long after becoming available the step is due. */
  @Prop({ required: true })
  slaMinutes: number;

  /** Inactive definitions are skipped when laying out a new onboarding. */
  @Prop({ default: true })
  active: boolean;
}

export const OnboardingStepDefinitionSchema = SchemaFactory.createForClass(
  OnboardingStepDefinitionRecord,
);

OnboardingStepDefinitionSchema.index(
  { agencyId: 1, stepKey: 1 },
  { unique: true },
);
OnboardingStepDefinitionSchema.index({ agencyId: 1, sortOrder: 1 });
