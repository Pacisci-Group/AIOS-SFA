import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type {
  BindIdStatus,
  ReconciliationIgnoredReason,
  ReconciliationIssue,
  ReconciliationMatch,
  ReconciliationReviewStatus,
  ReconciliationTab,
  StoredReconciliationResolution,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import type {
  RowAssignment,
  RowOutcome,
} from '../../common/carrier-reconciliation/carry-forward';
import type { DashRow } from '../../common/carrier-reconciliation/dash-file-reader';
import type { DashCredit } from '../../common/carrier-reconciliation/producer-code-index';
import type {
  AppPolicyLite,
  SuggestionRaw,
} from '../../common/carrier-reconciliation/reconcile';
import { ObjectIdType } from '../../common/mongo/object-id';

export type ReconciliationRowDocument = HydratedDocument<ReconciliationRow>;

/** A suggestion as stored: a Dash counterpart is named by its row id. */
export type StoredSuggestion = Omit<SuggestionRaw, 'rowKey'> & {
  rowId: string | null;
};

/**
 * A person's decision on a row. Ids are strings: this is a snapshot read back
 * whole, never queried by id.
 */
export interface StoredReview {
  status: ReconciliationReviewStatus;
  /**
   * A retired value only on a row decided before it was retired; an outcome
   * resolution (`sold_recorded`, …) only when the assignee's outcome finished
   * the row.
   */
  resolution: StoredReconciliationResolution | null;
  note: string | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
  /** The superseded run's row this decision was carried from. */
  carriedForwardFromRowId: string | null;
}

/**
 * One line of a run: a Dash line, an app policy Dash does not show, or both.
 *
 * Two layers, matching the engine (`common/carrier-reconciliation/reconcile.ts`):
 *
 * - **What matching found** — `side`, `match`, `isSale`, `dash`, `app`,
 *   `matchIssues`, `suggestions`. Fixed for the life of the run.
 * - **How it classifies against the users' Allstate codes** — `bindIdStatus`,
 *   `credit`, `producerKey`, `issues`, `tabs`, `needsReview`. Recomputed in
 *   place by `reclassify` after someone's code is set, without re-reading the
 *   file.
 *
 * `dash` and `app` are snapshots: their dates are calendar strings
 * (`YYYY-MM-DD`) and their ids strings, because they record what the file and
 * the app said at upload time and are never joined on.
 */
@Schema({ timestamps: true, collection: 'reconciliationRows' })
export class ReconciliationRow {
  @Prop({ required: true })
  agencyId: string;

  @Prop({ type: ObjectIdType, ref: 'ReconciliationRun', required: true })
  runId: Types.ObjectId;

  /** Stable across re-uploads of the same report — what review carry-forward keys on. */
  @Prop({ required: true })
  rowKey: string;

  @Prop({ type: String, required: true })
  side: 'dash' | 'app' | 'both';

  @Prop({ type: String, default: null })
  match: ReconciliationMatch | null;

  @Prop({ default: false })
  isSale: boolean;

  @Prop({ type: String, default: null })
  ignoredReason: ReconciliationIgnoredReason | null;

  @Prop({ type: Object, default: null })
  dash: DashRow | null;

  @Prop({ type: Object, default: null })
  app: AppPolicyLite | null;

  @Prop({ type: [String], default: [] })
  matchIssues: ReconciliationIssue[];

  @Prop({ type: [Object], default: [] })
  suggestions: StoredSuggestion[];

  @Prop({ type: String, default: null })
  bindIdStatus: BindIdStatus | null;

  @Prop({ type: Object, required: true })
  credit: DashCredit;

  /** `user:<id>`, `bind:<Bind ID>` or `none` — the producer filter. */
  @Prop({ required: true })
  producerKey: string;

  @Prop({ type: [String], default: [] })
  issues: ReconciliationIssue[];

  @Prop({ type: [String], default: [] })
  tabs: ReconciliationTab[];

  @Prop({ default: false })
  needsReview: boolean;

  @Prop({ type: Object, required: true })
  review: StoredReview;

  /**
   * Who the owner handed the row to (a Producer or CSR), or `null`. Its own
   * field rather than part of `review`, so saving a decision — which replaces
   * `review` whole — can never drop it. `userId` is a string, like every id in
   * these snapshots; queries must compare it as one.
   */
  @Prop({ type: Object, default: null })
  assignment: RowAssignment | null;

  /**
   * What the assignee recorded, or is recording: Sold, Cancel rewrite,
   * Chargeback, Service intake or Other (PAC-173 PR 4–6). Beside `assignment`
   * rather than inside it, so taking
   * a row back and handing it on are separate decisions about the outcome —
   * see `ReconciliationOutcomesService` for the rules between the three
   * fields. A row stored before outcomes existed has no field at all, which
   * `{ outcome: null }` matches too.
   */
  @Prop({ type: Object, default: null })
  outcome: RowOutcome | null;

  /** Lower-cased policy numbers and names, for the search box. */
  @Prop({ default: '' })
  searchText: string;

  /** Opts this schema into `authorshipPlugin`; see `TenantRecord`. */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ReconciliationRowSchema =
  SchemaFactory.createForClass(ReconciliationRow);
ReconciliationRowSchema.index(
  { agencyId: 1, runId: 1, rowKey: 1 },
  { unique: true },
);
/** A tab, in file order. */
ReconciliationRowSchema.index({ agencyId: 1, runId: 1, tabs: 1, _id: 1 });
ReconciliationRowSchema.index({ agencyId: 1, runId: 1, producerKey: 1 });
ReconciliationRowSchema.index({
  agencyId: 1,
  runId: 1,
  needsReview: 1,
  'review.status': 1,
});
/**
 * A person's assigned rows — their page, the dashboard panel, work transfer.
 * Not partial: a `$type` filter is one an equality query on the user id does
 * not prove, so the planner would never pick it.
 */
ReconciliationRowSchema.index({
  agencyId: 1,
  'assignment.userId': 1,
  'review.status': 1,
});
