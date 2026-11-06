import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  CHARGEBACK_IMPORT_STATUSES,
  IMPORT_ROW_NOTES,
  IMPORT_ROW_RESOLUTIONS,
  type ChargebackImportCommitResult,
  type ChargebackImportStatus,
  type ImportRowNote,
  type ImportRowResolution,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import type { ChargebackFileFormat } from '../../common/payouts/chargeback-file-reader';
import type { ImportRowMatch } from '../../common/payouts/match-import-rows';
import { ObjectIdType } from '../../common/mongo/object-id';

export type ChargebackImportDocument = HydratedDocument<ChargebackImport>;

/** The uploaded file. The key is a capability: never sent to a client. */
export class ChargebackImportFile {
  storageKey: string;
  filename: string;
  size: number;
  format: ChargebackFileFormat;
}

/**
 * One line of the report: what the file says, what matching found, and what
 * the owner decided.
 */
@Schema({ _id: false })
export class ChargebackImportRow {
  /** The line's row in the sheet, 1-based. The row's key within the import. */
  @Prop({ required: true })
  rowNumber: number;

  @Prop({ type: String, default: null })
  bindId: string | null;

  @Prop({ type: String, default: null })
  producerName: string | null;

  @Prop({ required: true })
  policyNumber: string;

  @Prop({ type: String, default: null })
  customerName: string | null;

  @Prop({ type: String, default: null })
  policyType: string | null;

  /** The carrier as the file gives it. */
  @Prop({ type: String, default: null })
  fileCarrier: string | null;

  /** The policy's carrier, else the file's, else the import's. */
  @Prop({ required: true })
  carrier: string;

  /** `YYYY-MM-DD`, as the file gives it. */
  @Prop({ type: String, default: null })
  soldDay: string | null;

  @Prop({ type: String, default: null })
  occurredDay: string | null;

  @Prop({ type: String, default: null })
  terminationReason: string | null;

  /** Premium dollars, positive. */
  @Prop({ required: true })
  amount: number;

  /** `match-import-rows.ts` `ImportRowMatch` — ids stay ObjectIds. */
  @Prop({ type: Object, required: true })
  match: ImportRowMatch;

  /** Who matching chose, and the resolution it gave: what `reset` returns to. */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  autoUserId: Types.ObjectId | null;

  @Prop({ type: String, enum: IMPORT_ROW_RESOLUTIONS, required: true })
  autoResolution: ImportRowResolution;

  @Prop({ type: String, enum: IMPORT_ROW_RESOLUTIONS, required: true })
  resolution: ImportRowResolution;

  /** Who a commit charges — the owner's choice, else matching's. */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  userId: Types.ObjectId | null;

  @Prop({ type: [String], enum: IMPORT_ROW_NOTES, default: [] })
  notes: ImportRowNote[];

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  assignedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  assignedAt: Date | null;

  /** The ledger row a commit wrote. */
  @Prop({ type: ObjectIdType, ref: 'Chargeback', default: null })
  chargebackId: Types.ObjectId | null;
}

export const ChargebackImportRowSchema =
  SchemaFactory.createForClass(ChargebackImportRow);

/**
 * One upload of the month's chargeback report (PAC-180): `preview` while the
 * owner resolves it, then `committed` (its lines are in the `chargebacks`
 * ledger) or `discarded`.
 *
 * The lines live on the import (≤ `MAX_PAYOUT_IMPORT_ROWS`, a few hundred
 * bytes each): an import is read and committed whole, and a line means
 * nothing outside it.
 *
 * Agency-wide and branch-less, like `reconciliationRuns` — a report spans
 * branches, which is also why every import route is the admin's.
 */
@Schema({ timestamps: true, collection: 'chargebackImports' })
export class ChargebackImport {
  @Prop({ required: true, index: true })
  agencyId: string;

  /** The import's carrier: for lines that name none and match no policy. */
  @Prop({ required: true, trim: true })
  carrier: string;

  /** The pay month the chargebacks count in, `YYYY-MM`. */
  @Prop({ required: true })
  month: string;

  @Prop({ type: String, enum: CHARGEBACK_IMPORT_STATUSES, required: true })
  status: ChargebackImportStatus;

  @Prop({ type: Object, required: true })
  file: ChargebackImportFile;

  /**
   * SHA-256 of the uploaded bytes. Uniquely indexed, so the same file is
   * imported once — a second upload is a 409 naming the first. Cleared when
   * an import is discarded, so the file can be uploaded again.
   */
  @Prop({ type: String, default: null })
  fileSha256: string | null;

  /** Where the header was found (`null` sheet for a CSV). */
  @Prop({ type: String, default: null })
  sheetName: string | null;

  @Prop({ required: true })
  headerRowNumber: number;

  /** Each field read, and the header it came from. */
  @Prop({ type: [Object], default: [] })
  columns: { field: string; header: string }[];

  /** Lines left out while reading, and columns the report lacks. */
  @Prop({ type: [String], default: [] })
  warnings: string[];

  @Prop({ type: [ChargebackImportRowSchema], default: [] })
  rows: ChargebackImportRow[];

  @Prop({ type: Date, default: null })
  committedAt: Date | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  committedBy: Types.ObjectId | null;

  /** What the commit wrote and recalculated. */
  @Prop({ type: Object, default: null })
  result: ChargebackImportCommitResult | null;

  @Prop({ type: Date, default: null })
  discardedAt: Date | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  discardedBy: Types.ObjectId | null;

  /** Opts this schema into `authorshipPlugin`; see `TenantRecord`. */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ChargebackImportSchema =
  SchemaFactory.createForClass(ChargebackImport);

/** The Payouts page's list: a month's imports, newest first. */
ChargebackImportSchema.index({ agencyId: 1, month: 1, createdAt: -1 });

/** The same bytes are imported once. Partial: a discarded import frees its hash. */
ChargebackImportSchema.index(
  { agencyId: 1, fileSha256: 1 },
  {
    unique: true,
    partialFilterExpression: { fileSha256: { $type: 'string' } },
  },
);
