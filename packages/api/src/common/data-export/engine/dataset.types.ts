import type {
  DataExportColumnDescriptor,
  DataExportDatasetKey,
  DataExportFilterKey,
  DataExportScope,
} from '@sfa/shared';
import type { PipelineStage, Types } from 'mongoose';
import type { ExportLookups } from './lookups';

/**
 * What a column's `pick` may return. The writer encodes it according to the
 * column's declared `type` — a `pick` never formats, so CSV and XLSX cannot
 * disagree about a value.
 */
export type CellValue =
  | string
  | number
  | boolean
  | Date
  | Types.ObjectId
  | readonly unknown[]
  | null
  | undefined;

/**
 * How a date field is stored, which decides how a calendar `from`/`to` becomes
 * a Mongo window:
 *
 * - `ymd`         — a `YYYYMMDD` integer already cut on the agency calendar
 *                   (`soldDateYmd`, `quoteDateYmd`).
 * - `instant`     — a real moment (`createdAt`, `lastActivityAt`): bounds are
 *                   the start of each day in the agency's timezone.
 * - `utcDate`     — a calendar date stored as UTC midnight (`effectiveDate`,
 *                   `dateOfBirth`): bounds are UTC midnights.
 * - `leadCreated` — `createdDate ?? createdAt`, bucketed by
 *                   `leadCreatedYmdExpr`: the rule the Owner and Manager views
 *                   count leads by, so an export agrees with them.
 */
export type DateFieldKind = 'ymd' | 'instant' | 'utcDate' | 'leadCreated';

export interface DateFieldDef {
  key: string;
  label: string;
  /** The stored field; ignored for `leadCreated`. */
  path: string;
  kind: DateFieldKind;
  isDefault?: true;
}

/**
 * What a column's `pick` reads. `lookups` holds every label the batch's
 * `joins` primed (names, refs, contact details); `joins` holds what is
 * specific to the dataset (child rollups keyed by parent id).
 */
export interface RowContext<J> {
  joins: J;
  lookups: ExportLookups;
  timeZone: string;
}

export interface ColumnDef<Row, J> extends DataExportColumnDescriptor {
  pick: (row: Row, ctx: RowContext<J>) => CellValue;
}

/** What the engine hands a dataset when it asks for one batch's joins. */
export interface JoinContext {
  lookups: ExportLookups;
  timeZone: string;
}

/**
 * One exportable dataset. Everything the engine needs is declared here, so a
 * new dataset is one file and one registry line — it never touches the
 * engine.
 */
export interface DatasetDef<Row, J> {
  key: DataExportDatasetKey;
  label: string;
  description: string;
  /** Mongoose model name (`Lead.name`); the engine resolves the model. */
  model: string;
  scope: DataExportScope;
  dateFields: readonly DateFieldDef[];
  /** The filters this dataset honours; any other is a 400. */
  filters: readonly DataExportFilterKey[];
  /** Required whenever `filters` includes `status`. */
  status?: {
    values: readonly string[];
    /** One selected label → every stored spelling of it. */
    queryValues: (label: string) => string[];
    path: string;
  };
  /** Field the `policyTypes` filter applies to (expanded via `policyTypeValues`). */
  policyTypePath?: string;
  /**
   * Where the row's lead source lives:
   *
   * - `direct`  — its own `leadSourceId` (a lead).
   * - `viaLead` — through its lead (`sourceStages`: the lead owns the
   *   source), with the row's own `leadSourceId` as the fallback when
   *   `ownFallback` (a deal; a quote recap has none of its own).
   *
   * For `viaLead` the engine always adds `sourceStages`, so every row
   * carries the resolved `sourceId` for its columns — and the
   * `leadSourceIds` filter matches on that, exactly as the Owner view does.
   */
  leadSource?: { kind: 'direct' } | { kind: 'viaLead'; ownFallback: boolean };
  /** Extra stages after the window, before the sort. */
  preStages?: () => PipelineStage[];
  /** One round of batched loads for a batch of rows. */
  joins: (rows: readonly Row[], ctx: JoinContext) => Promise<J>;
  columns: readonly ColumnDef<Row, J>[];
}

/** A dataset with its row/join types erased, for the registry. */

export type AnyDatasetDef = DatasetDef<any, any>;

/** Type-checks a dataset's columns against its row and join types. */
export function defineDataset<Row, J>(
  def: DatasetDef<Row, J>,
): DatasetDef<Row, J> {
  return def;
}
