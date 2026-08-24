import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type DealAuditItemDocument = HydratedDocument<DealAuditItem>;

/** A document uploaded when a producer resolves an audit item. */
@Schema({ _id: false })
export class DealAuditAttachment {
  /** Object storage key (agency-namespaced, server-generated). */
  @Prop({ required: true })
  key: string;

  @Prop({ required: true })
  filename: string;

  @Prop({ required: true })
  contentType: string;

  @Prop({ required: true })
  size: number;

  @Prop({ type: Date, default: Date.now })
  uploadedAt: Date;
}

export const DealAuditAttachmentSchema =
  SchemaFactory.createForClass(DealAuditAttachment);

/**
 * Migrated from SmartSuite "The Deal Audit Items Table" (69533b022b0995e027431c02).
 * Individual checklist rows under a Deal Audit; backs the Deals Pending Service
 * Hand-off board (each open item is a row).
 */
@Schema({ timestamps: true, collection: 'dealAuditItems' })
export class DealAuditItem extends TenantRecord {
  @Prop({ trim: true })
  title?: string;

  @Prop({ type: Types.ObjectId, ref: 'Deal', index: true })
  dealId?: Types.ObjectId;

  @Prop({ index: true })
  legacyDealId?: string;

  @Prop()
  itemName?: string;

  @Prop()
  category?: string;

  /*
   * Generation provenance (PAC-40). All optional — migrated items have none of
   * it, and the board never reads these.
   */

  /** The `auditTemplates` row this item was generated from. */
  @Prop({ type: Types.ObjectId, ref: 'AuditTemplate' })
  templateId?: Types.ObjectId;

  /** The parent roll-up audit record. */
  @Prop({ type: Types.ObjectId, ref: 'DealAudit' })
  dealAuditId?: Types.ObjectId;

  /**
   * Which policy triggered this item. On a bundled Auto + Home sale the deal
   * alone cannot say whether `Home Inspection` came from the home or the
   * landlord line.
   */
  @Prop({ type: Types.ObjectId, ref: 'Policy' })
  policyId?: Types.ObjectId;

  /**
   * Who this item is about, when one template fans out into several items —
   * today only Defensive Driver, which generates one certificate per selected
   * driver. Also suffixed onto `itemName`, so the board's "missing" column
   * distinguishes them.
   */
  @Prop({ trim: true })
  subjectName?: string;

  @Prop({ type: Types.ObjectId, ref: 'Contact' })
  subjectContactId?: Types.ObjectId;

  /** The generating deal's submission token; mirrors legacy's item field. */
  @Prop({ trim: true })
  submissionToken?: string;

  /**
   * `<dealId>|<normalized title>|<subjectName>` — the idempotency key.
   *
   * Legacy deduped by reading the deal's existing items and skipping matches,
   * which races: two concurrent generations both read an empty set and both
   * insert. A unique index makes "generating twice creates one item" true at
   * the database level instead.
   */
  @Prop({ trim: true })
  dedupeKey?: string;

  /** Raw SmartSuite status value (sdb5069dbd): backlog | in_progress (=Failed) | complete. */
  @Prop()
  status?: string;

  @Prop()
  statusLabel?: string;

  /** Update/verification status (s5cd2f1d5a): backlog | in_progress | complete. */
  @Prop()
  updateStatus?: string;

  @Prop()
  updateStatusLabel?: string;

  /** Item failed the audit and still needs producer action (hand-off pending). */
  @Prop({ default: false, index: true })
  isFailed: boolean;

  @Prop({ default: false, index: true })
  isResolved: boolean;

  @Prop({ default: false })
  required: boolean;

  @Prop({ default: false })
  blocking: boolean;

  @Prop({ default: true })
  applicable: boolean;

  @Prop({ trim: true })
  clientName?: string;

  @Prop({ trim: true })
  producerName?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  producerId?: Types.ObjectId;

  @Prop({ default: 0 })
  daysOpen: number;

  @Prop({ type: Date })
  firstCreatedAt?: Date;

  /**
   * The soft 7-day deadline (PAC-65).
   *
   * ⚠ **A written target, not enforcement.** Nothing reads this to change
   * state: no cron, no auto-fail, no escalation, no expiry, and no status that
   * flips itself at day 7. It exists so the team can see a date on the board
   * and pull an overdue list — and that is the whole of it. An item past its
   * `dueAt` is still `in_progress` / failed until a human resolves it.
   *
   * Optional with no default: items generated before this field existed simply
   * have none, match neither board filter, and are never overdue. There is no
   * backfill, because retro-stamping a deadline onto old items would
   * manufacture an overdue backlog nobody agreed to.
   */
  @Prop({ type: Date })
  dueAt?: Date;

  /** Free-text note captured when the producer resolves the item. */
  @Prop({ trim: true })
  notes?: string;

  /** When the item was resolved (producer marked verified/received). */
  @Prop({ type: Date })
  resolvedAt?: Date;

  /** The user (producer) who resolved the item. */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  resolvedById?: Types.ObjectId;

  /** Supporting documents uploaded on resolution. */
  @Prop({ type: [DealAuditAttachmentSchema], default: [] })
  attachments: DealAuditAttachment[];

  @Prop({ default: false, index: true })
  isTestRecord: boolean;
}

export const DealAuditItemSchema = SchemaFactory.createForClass(DealAuditItem);
DealAuditItemSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);

/**
 * The hand-off board's query (PAC-12): filters on agency + producer + the two
 * status booleans, then sorts `daysOpen` descending with `_id` as tiebreak.
 * Carrying the sort keys in the index keeps it a pure IXSCAN — without them
 * Mongo would fetch the whole filtered set and sort it in memory.
 */
DealAuditItemSchema.index({
  agencyId: 1,
  producerId: 1,
  isFailed: 1,
  isResolved: 1,
  daysOpen: -1,
  _id: 1,
});

/**
 * The same board query, filtered by due date (PAC-65).
 *
 * ⚠ A **separate** index rather than adding `dueAt` to the one above. Mongoose
 * `autoIndex` only creates indexes that are *missing* — it never rebuilds one
 * whose definition changed — so editing the existing key pattern would leave
 * every existing collection on the old definition and silently need a migration
 * script. A brand-new key pattern is created normally, and needs none.
 */
DealAuditItemSchema.index({
  agencyId: 1,
  producerId: 1,
  isFailed: 1,
  isResolved: 1,
  dueAt: 1,
});

/**
 * The board's per-page item fetch (PAC-72).
 *
 * Since the board became audits-first, `listPendingHandoff` pages over
 * `dealAudits` and then loads the open items for just that page with
 * `dealAuditId: { $in: [...] }`. This serves that, and the counter recompute
 * in `syncCounters` which reads the same shape one audit at a time.
 *
 * ⚠ The two `producerId`-prefixed board indexes above are now **dead** — the
 * access key moved off the item and onto `DealAudit.auditAssignee`. They are
 * left in place rather than edited: this is a new key pattern, which
 * `autoIndex` creates on its own, whereas removing theirs is an index change
 * needing a migration script. Drop them in that cleanup, not here.
 */
DealAuditItemSchema.index({
  agencyId: 1,
  dealAuditId: 1,
  isFailed: 1,
  isResolved: 1,
});

/**
 * Makes audit generation idempotent (PAC-40): re-running it for a deal creates
 * nothing new, so a retried submission cannot double the service team's
 * hand-off. Partial, never `sparse` — every migrated item lacks a `dedupeKey`,
 * and a compound sparse unique index would E11000 on the second one.
 */
DealAuditItemSchema.index(
  { agencyId: 1, dedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { dedupeKey: { $type: 'string' } },
  },
);
