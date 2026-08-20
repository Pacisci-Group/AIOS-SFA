import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';
import type {
  ActivityChangeKind,
  ActivitySubjectType,
  ActivityType,
} from '@sfa/shared';

export type ActivityDocument = HydratedDocument<Activity>;

// The unions moved to `@sfa/shared` (PAC-38): the Lead Detail timeline renders
// one icon and tone per type, and the web app cannot import from the API.
// Re-exported so existing API-side importers keep working.
export type { ActivityChangeKind, ActivitySubjectType, ActivityType };

/**
 * One field's before/after on a `field_changed` row (PAC-65 #9).
 *
 * Mirrors `ActivityChange` in `@sfa/shared`, which documents the value rules
 * the writer must hold to. `from`/`to` are `Object` because they span string,
 * number, `string[]` and null — a single Mixed slot is the honest storage for
 * "whatever this field holds", and `kind` is what tells the client how to read
 * it. Always write `null`, never `undefined`: Mongo drops the latter, and a
 * missing `from` reads as "there was no previous value" rather than "cleared".
 */
@Schema({ _id: false })
export class ActivityChangeEntry {
  @Prop({ required: true })
  field: string;

  @Prop({ required: true })
  label: string;

  // `type: String` for the same `emitDecoratorMetadata` reason as `type` below.
  @Prop({ type: String, required: true })
  kind: ActivityChangeKind;

  @Prop({ type: Object, default: null })
  from: string | number | string[] | null;

  @Prop({ type: Object, default: null })
  to: string | number | string[] | null;
}

export const ActivityChangeEntrySchema =
  SchemaFactory.createForClass(ActivityChangeEntry);

/**
 * Derived activity/timeline collection. Seeded from lead/quote/deal lifecycle events
 * during migration; extended going forward by lead quick actions (PAC-16).
 * `legacySmartSuiteId` holds a synthetic dedupe key (e.g. "sold:<dealLegacyId>").
 */
@Schema({ timestamps: true, collection: 'activities' })
export class Activity extends TenantRecord {
  // `type: String` is explicit for both of these because the unions are now
  // indexed-access types (`(typeof ACTIVITY_TYPES)[number]`), which
  // `emitDecoratorMetadata` reports as `Object` — Mongoose can't infer from it.
  // Same trap as `Lead.temperature`.
  @Prop({ type: String, required: true, index: true })
  type: ActivityType;

  @Prop({ type: String, required: true })
  subjectType: ActivitySubjectType;

  @Prop({ index: true })
  legacySubjectId?: string;

  @Prop({ type: Types.ObjectId, ref: 'Lead' })
  leadId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Deal' })
  dealId?: Types.ObjectId;

  /**
   * Set by `POST /quote-recaps` (PAC-39). Unset on migrated `quoted` rows,
   * which identify their subject through `legacySubjectId` instead.
   */
  @Prop({ type: Types.ObjectId, ref: 'QuoteRecap' })
  quoteRecapId?: Types.ObjectId;

  /**
   * Whoever wrote the row — **not** necessarily a producer (PAC-65).
   *
   * `POST /activities` is gated on `leads:write`, which the Branch Manager and
   * CSR templates both hold, and an `audit_resolved` row is written by whoever
   * cleared the hand-off item — typically a CRM. The field was called
   * `producerId` until the rename; it never meant that.
   *
   * Distinct from `Lead.producerId` / `Deal.producerId` / `QuoteRecap.producerId`,
   * which really are producer refs and drive `buildScopeFilter`'s `own` clamp.
   */
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  userId?: Types.ObjectId;

  /**
   * Which policy a `field_changed` row describes (PAC-65 #9).
   *
   * A deal can hold several policies, so `dealId` alone leaves two edit rows on
   * the same sale indistinguishable. Deliberately **not** indexed — the lesson
   * of the two dead `producerId` indexes this collection carried is that an
   * index for a predicate nobody queries is pure cost. Add one when a query
   * needs it.
   */
  @Prop({ type: Types.ObjectId, ref: 'Policy' })
  policyId?: Types.ObjectId;

  @Prop({ type: Date, index: true })
  occurredAt?: Date;

  /**
   * ⚠ On a `field_changed` row this stays **deliberately value-free** — "Quote
   * recap edited", never "Premium changed to $1,400".
   *
   * `summary` is the one field that escapes the change-log permission gate:
   * `HotLeadsService` renders whatever the newest activity's summary says
   * straight onto the producer's own dashboard. The `$ne` filters are the real
   * control, but keeping the values out of `summary` means a missed filter
   * degrades to a bland heading rather than leaking a premium.
   */
  @Prop({ trim: true })
  summary?: string;

  /** Populated only on `field_changed`. See {@link ActivityChangeEntry}. */
  @Prop({ type: [ActivityChangeEntrySchema], default: undefined })
  changes?: ActivityChangeEntry[];

  @Prop({ default: 'migration' })
  source: string;

  @Prop({ default: false })
  isTestRecord: boolean;
}

export const ActivitySchema = SchemaFactory.createForClass(Activity);
ActivitySchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
// The Lead Detail timeline (PAC-38) — the only index this collection is
// actually queried through.
//
// There was a second, `{ agencyId, userId, occurredAt }` (`producerId` before
// the PAC-65 rename), dropped because nothing ever used it: no query anywhere
// filters or sorts activities by their author. `LeadDetailService` and
// `HotLeadsService` both key on `leadId`, the dashboards never read this
// collection at all, and `buildScopeFilter` — whose `producerField` default is
// what the old index was shaped for — is never applied to this model. Add one
// back when an author-scoped query exists, not before.
ActivitySchema.index({ agencyId: 1, leadId: 1, occurredAt: -1 });
