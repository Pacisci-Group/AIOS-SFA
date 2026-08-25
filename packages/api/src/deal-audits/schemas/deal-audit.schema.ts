import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  AUDIT_OWNER_TYPES,
  DEAL_AUDIT_STATUSES,
  DEFAULT_DEAL_AUDIT_STATUS,
} from '@sfa/shared';
import type { AuditOwnerType, DealAuditStatus } from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type DealAuditDocument = HydratedDocument<DealAudit>;

/**
 * Who owns an audit — a specific user, or a role acting as a queue (PAC-72).
 *
 * 🔴 `id` is **always an ObjectId, never a role slug.** A field that is
 * sometimes an ObjectId and sometimes a string forces every read to branch,
 * cannot be indexed usefully, and breaks the moment someone renames a role.
 * `AgencyRole` has both an `_id` and a slug; this stores the `_id` and the
 * display name is resolved at read time.
 *
 * That choice is also what lets `buildScopeFilter` clamp both kinds with a
 * single `{ 'auditAssignee.id': { $in: [me, ...myRoleIds] } }` — see its
 * `ownerField` option.
 */
@Schema({ _id: false })
export class AuditOwnerRef {
  // `type: String` is explicit because the union is an indexed-access type,
  // which `emitDecoratorMetadata` reports as `Object`. Same trap as
  // `Activity.type` and `Lead.temperature`.
  @Prop({ type: String, enum: AUDIT_OWNER_TYPES, required: true })
  type: AuditOwnerType;

  @Prop({ type: Types.ObjectId, required: true })
  id: Types.ObjectId;
}

export const AuditOwnerRefSchema = SchemaFactory.createForClass(AuditOwnerRef);

/**
 * Migrated from SmartSuite "The Deal Audits Table" (6941fdb2dc9a6d024fd8caef).
 * The parent audit summary for a deal (rolls up Deal Audit Items -> dealAuditItems).
 *
 * **This is the hand-off board's driving collection since PAC-72.** It was a
 * roll-up nothing read; the board now queries it directly — one document is one
 * card — and fetches each card's open items separately. The alternative,
 * grouping `dealAuditItems` by `dealId`, cannot apply the data-scope clamp
 * before the `$group` (the assignee lives here, not on the item) and so scans
 * the whole agency on every board load.
 */
@Schema({ timestamps: true, collection: 'dealAudits' })
export class DealAudit extends TenantRecord {
  @Prop({ trim: true })
  title?: string;

  @Prop()
  auditId?: string;

  @Prop({ type: Date })
  auditDate?: Date;

  /**
   * The 4-state workflow: `Not Submitted → Pending → Pass / Fail`.
   *
   * Replaces the old `result` field, which was a `Pass`/`Fail` single-select —
   * a strict subset of these four — written only by the migration. Two fields
   * answering the same question is how they drift, so `result` is gone and the
   * migration maps it onto this.
   *
   * `Deal.dealAuditStatus` mirrors this value for display; **this is the
   * authoritative copy.** Keeping the workflow on the audit rather than the
   * sales record is deliberate (PAC-72 section E).
   */
  /*
   * Deliberately **unindexed**. Nothing queries by status alone: the board
   * filters on `openFailedCount`, and the workflow endpoints load one audit by
   * `dealId`. The two dead `producerId` indexes dropped from `activities` are
   * the standing reminder that an index for a predicate nobody uses is pure
   * write cost — add one with the query that needs it (a failed-deals view is
   * the likely first, in section B item 10).
   */
  @Prop({
    type: String,
    enum: DEAL_AUDIT_STATUSES,
    default: DEFAULT_DEAL_AUDIT_STATUS,
  })
  auditStatus: DealAuditStatus;

  /**
   * Why it failed. Vocabulary is SmartSuite's `reason_codes` multi-select — see
   * `DEAL_AUDIT_REASON_CODES`. Written by the review endpoint; empty on a pass.
   */
  @Prop({ type: [String], default: [] })
  reasonCodes: string[];

  @Prop({ default: 0 })
  auditScore: number;

  @Prop()
  auditNotes?: string;

  /*
   * Ownership (PAC-72 section E). Both optional: an audit that predates
   * assignment, or one whose role was deleted, is still a valid record — it
   * simply reaches nobody's `own`-scoped board until someone assigns it.
   */

  /** Gathers the evidence and submits for review. The board's access key. */
  @Prop({ type: AuditOwnerRefSchema, default: null })
  auditAssignee?: AuditOwnerRef | null;

  /** Approves, requests changes, or sends it back. */
  @Prop({ type: AuditOwnerRefSchema, default: null })
  auditReviewer?: AuditOwnerRef | null;

  @Prop({ type: Date })
  submittedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  submittedById?: Types.ObjectId;

  @Prop({ type: Date })
  reviewedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reviewedById?: Types.ObjectId;

  /*
   * Denormalized roll-ups of this audit's items (PAC-72 section A).
   *
   * ⚠ Maintained by `AuditGenerationService` (on generate) and
   * `DealAuditsService.resolveItem` (on resolve). They exist because the board
   * needs to **sort and paginate by them server-side**, which an aggregation
   * over `dealAuditItems` cannot do while still being index-backed — and
   * because the completion percentage needs a stored denominator at all.
   * `Deal.auditItemCount` holds a total nothing ever read; a resolved count was
   * stored nowhere.
   *
   * Drift is the accepted cost. Recompute with `syncCounters` rather than
   * hand-patching.
   */

  /** Every item generated for the deal — the completion-% denominator. */
  @Prop({ default: 0 })
  itemCount: number;

  /** How many have been resolved — the numerator. */
  @Prop({ default: 0 })
  resolvedCount: number;

  /** Still failed and unresolved. Zero means the card leaves the board. */
  @Prop({ default: 0 })
  openFailedCount: number;

  /** `firstCreatedAt` of the oldest open item — the board's sort key. */
  @Prop({ type: Date })
  oldestOpenAt?: Date;

  /**
   * The earliest soft deadline across the open items, for the board's `due`
   * filter (PAC-65).
   *
   * ⚠ Still a written target and nothing more. Nothing reads this to change
   * state — no cron, no auto-fail, no escalation. Absent when no open item
   * carries one, which is neither overdue nor due-soon.
   */
  @Prop({ type: Date })
  dueAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'Deal', index: true })
  dealId?: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  legacyDealIds: string[];

  @Prop({ default: false, index: true })
  isTestRecord: boolean;
}

export const DealAuditSchema = SchemaFactory.createForClass(DealAudit);
DealAuditSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);

/**
 * The hand-off board's query (PAC-72): agency + assignee, deals with at least
 * one outstanding item, oldest open first.
 *
 * Serves a user-assigned *and* a role-assigned audit with one key pattern,
 * precisely because `auditAssignee.id` is an ObjectId either way — which is why
 * the field is modelled that way.
 *
 * Key order follows equality → sort → range: `agencyId` and the assignee are
 * matched exactly, `oldestOpenAt` is the sort, and `openFailedCount` is the
 * `> 0` range predicate. Putting the range before the sort key would force an
 * in-memory sort over the filtered set.
 *
 * ⚠ An earlier draft of this index led with `auditStatus`. The board does not
 * filter on status — a deal with outstanding documents is on it whether the
 * audit is Not Submitted, Pending or Fail — so that index served nothing. It
 * never shipped beyond this branch; if it exists in a local database, drop
 * `agencyId_1_auditAssignee.id_1_auditStatus_1_oldestOpenAt_-1` by hand.
 */
DealAuditSchema.index({
  agencyId: 1,
  'auditAssignee.id': 1,
  oldestOpenAt: 1,
  openFailedCount: 1,
});

/** The same board query narrowed by the soft deadline (PAC-65's `due` filter). */
DealAuditSchema.index({
  agencyId: 1,
  'auditAssignee.id': 1,
  dueAt: 1,
  openFailedCount: 1,
});

/**
 * "The roll-up for this deal" — the generator's upsert key and the workflow
 * endpoints' lookup.
 *
 * ⚠ **Deliberately NOT unique**, even though the board treats one audit as one
 * deal. SmartSuite's Deal Audits table links `Deals` as a *multiple* field, so
 * two legacy audit rows may name the same deal (a re-audit). The migration
 * dedupes on `legacySmartSuiteId`, so both would import — and a unique index
 * would E11000 partway through the run. A duplicate card on the board is a
 * visible annoyance; a migration that dies halfway is a much worse failure.
 *
 * `AuditGenerationService` upserts on this pair, so nothing the *app* creates
 * can duplicate. If the legacy data turns out to be clean, tightening this to
 * unique is a deliberate follow-up — and, per the house rule, an index-options
 * change that needs its own migration script.
 */
DealAuditSchema.index({ agencyId: 1, dealId: 1 });
