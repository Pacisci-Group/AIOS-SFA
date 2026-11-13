import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  RECONCILIATION_RUN_STATUSES,
  type ReconciliationRunStatus,
  type ReconciliationTotals,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import type { DashFileMeta } from '../../common/carrier-reconciliation/dash-file-reader';
import type {
  ProducerSummaryRaw,
  ReportWindow,
} from '../../common/carrier-reconciliation/reconcile';
import { ObjectIdType } from '../../common/mongo/object-id';

export type ReconciliationRunDocument = HydratedDocument<ReconciliationRun>;

/**
 * The uploaded report. The key is a capability: never sent to a client.
 * `null` on a failed run, whose upload is deleted — so the key never names an
 * object that is gone, and the only run a key can name is one that kept it.
 */
export class ReconciliationRunFile {
  storageKey: string | null;
  filename: string;
  size: number;
}

/**
 * One uploaded Dash report and what reconciling it found.
 *
 * Processed inside the upload request: `processing` while its rows are
 * written, then `ready` or `failed`. A run left `processing` by a process that
 * died mid-request reads as failed once it is stale (`STALE_RUN_MINUTES`).
 *
 * Uploading the same report period again (a corrected export, or after
 * setting people's Allstate codes) **supersedes** the earlier run: the new one
 * links `supersedesRunId`, the old one `supersededByRunId` and drops out of
 * the default list, and review decisions carry across where the row still
 * says the same thing.
 *
 * Agency-wide and branch-less — the `DataExport` pattern: `TenantRecord`
 * requires a `branchId`, and a carrier report has no branch.
 */
@Schema({ timestamps: true, collection: 'reconciliationRuns' })
export class ReconciliationRun {
  @Prop({ required: true, index: true })
  agencyId: string;

  @Prop({ type: ObjectIdType, ref: 'Carrier', required: true })
  carrierId: Types.ObjectId;

  @Prop({ type: String, enum: RECONCILIATION_RUN_STATUSES, required: true })
  status: ReconciliationRunStatus;

  @Prop({ type: String, default: null })
  error: string | null;

  @Prop({ type: Object, required: true })
  file: ReconciliationRunFile;

  /**
   * SHA-256 of the uploaded bytes. Uniquely indexed, so the same file cannot
   * be reconciled twice — a double-clicked upload is a 409, not a second run.
   * Cleared when a run fails, so the file can be tried again.
   */
  @Prop({ type: String, default: null })
  fileSha256: string | null;

  /** What the report says about itself (agent, period, who downloaded it). */
  @Prop({ type: Object, required: true })
  fileMeta: DashFileMeta & { rowCount: number };

  /** The report period actually used — the file's, or one inferred from its lines. */
  @Prop({ type: Object, default: null })
  window: ReportWindow | null;

  @Prop({ type: [String], default: [] })
  warnings: string[];

  @Prop({ type: Object, default: null })
  totals: ReconciliationTotals | null;

  @Prop({ type: [Object], default: [] })
  byProducer: ProducerSummaryRaw[];

  @Prop({ type: ObjectIdType, default: null })
  supersedesRunId: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, default: null })
  supersededByRunId: Types.ObjectId | null;

  /**
   * The report period this run is the current one for (`runPeriodKey`), and
   * `null` otherwise — while it processes, once it fails, and once a re-upload
   * replaces it. Uniquely indexed, so one period has at most one current run:
   * two uploads of the same period finishing together cannot both win.
   */
  @Prop({ type: String, default: null })
  currentKey: string | null;

  /**
   * When the owner closed this month, and who (PAC-173 review). A closed run
   * is still the period's current run — the owner reads and decides its rows
   * as before — but it is not one of `currentRunIds`, so its rows are on no
   * one's list and none can be handed to anyone. Without it every month ever
   * uploaded stayed on people's lists for good. A re-upload of the month
   * carries both fields to the run that replaces it; reopening clears them.
   */
  @Prop({ type: Date, default: null })
  closedAt: Date | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  closedById: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  startedAt: Date | null;

  @Prop({ type: Date, default: null })
  finishedAt: Date | null;

  @Prop({ default: 0 })
  durationMs: number;

  /** Opts this schema into `authorshipPlugin`; see `TenantRecord`. */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ReconciliationRunSchema =
  SchemaFactory.createForClass(ReconciliationRun);
ReconciliationRunSchema.index({ agencyId: 1, createdAt: -1 });
/** The same bytes are reconciled once. Partial: a failed run releases its hash. */
ReconciliationRunSchema.index(
  { agencyId: 1, fileSha256: 1 },
  {
    unique: true,
    partialFilterExpression: { fileSha256: { $type: 'string' } },
  },
);
/** The run a re-upload of the same period supersedes. */
ReconciliationRunSchema.index({
  agencyId: 1,
  'fileMeta.agentNumber': 1,
  'window.from': 1,
  'window.to': 1,
  createdAt: -1,
});
/**
 * The agency's current runs (`currentRunIds`): every assignee list asks. Its
 * `closedAt: null` is checked on the few runs this prefix finds — one per
 * month uploaded — so it needs no key of its own.
 */
ReconciliationRunSchema.index({ agencyId: 1, status: 1, supersededByRunId: 1 });
/** One current run per report period. Partial: only the current one holds a key. */
ReconciliationRunSchema.index(
  { agencyId: 1, currentKey: 1 },
  {
    unique: true,
    partialFilterExpression: { currentKey: { $type: 'string' } },
  },
);

/** The report period a run covers, as `currentKey` stores it. */
export function runPeriodKey(
  agentNumber: string | null | undefined,
  window: ReportWindow,
): string {
  return `${agentNumber ?? ''}|${window.from}|${window.to}`;
}
