import { BadRequestException } from '@nestjs/common';
import {
  type AccessContext,
  type DataExportDatasetKey,
  type DataExportFilterEcho,
  type DataExportFilterKey,
  DataScope,
} from '@sfa/shared';
import type { PipelineStage } from 'mongoose';
import { clientAgencyId, clientScopeFilter } from '../access/client-scope';
import { buildScopeFilter } from '../access/scope-filter';
import {
  policyTypeValues,
  sourceMatch,
  sourceStages,
} from '../sales-metrics/sales-pipelines';
import type { AnyDatasetDef, DateFieldDef } from './engine/dataset.types';
import { dateWindowStages } from './engine/date-window';
import { DATASETS } from './engine/registry';

/**
 * What an export was asked for — the validated request body, or the filter
 * echo stored on its `dataExports` row. Both shapes fit, which is the point:
 * the API plans from the first to count the rows and refuse an oversize
 * export, and the worker re-plans from the second to produce the file.
 */
export interface ExportRequest {
  dateField?: string | null;
  from?: string | null;
  to?: string | null;
  branchId?: string | null;
  producerIds?: readonly string[] | null;
  status?: readonly string[] | null;
  policyTypes?: readonly string[] | null;
  leadSourceIds?: readonly string[] | null;
}

/** What one export resolved to before a row is read. */
export interface ExportPlan {
  def: AnyDatasetDef;
  agencyId: string;
  dateField: DateFieldDef;
  pipeline: PipelineStage[];
  echo: DataExportFilterEcho;
  /** The branch the rows were narrowed to, for the log. */
  branchId: string | null;
}

const list = (values: readonly string[] | null | undefined): string[] => [
  ...(values ?? []),
];

/**
 * Validates a request against its dataset and builds the pipeline (PAC-152).
 *
 * Pure: everything it needs is in `access` and the request, which is why the
 * worker can run it again minutes later from the stored row. A pipeline itself
 * cannot be stored — `$match` keys are illegal Mongo field names — so what is
 * persisted is the input to this function, never its output.
 *
 * Every check that can fail does so here. In the API that makes a bad request
 * an ordinary 400 before anything is queued; in the worker it can only fail if
 * the registry changed underneath a queued export, and the job then records
 * the export as failed.
 *
 * @param branchId the request's resolved branch (`X-Branch-Id`), which the
 *   producer-scope clamp reads; ignored at agency scope.
 */
export function planExport(
  access: AccessContext,
  branchId: string | null,
  key: DataExportDatasetKey,
  query: ExportRequest,
): ExportPlan {
  const agencyId = clientAgencyId(access);
  const def = DATASETS[key];
  if (!def) throw new BadRequestException(`Unknown dataset ${String(key)}`);

  const dateField = query.dateField
    ? def.dateFields.find((field) => field.key === query.dateField)
    : def.dateFields.find((field) => field.isDefault);
  if (!dateField) {
    throw new BadRequestException(
      `dateField must be one of: ${def.dateFields.map((field) => field.key).join(', ')}`,
    );
  }

  const producerIds = list(query.producerIds);
  const status = list(query.status);
  const policyTypes = list(query.policyTypes);
  const leadSourceIds = list(query.leadSourceIds);
  const requestedBranchId = query.branchId ?? null;

  const requested: [DataExportFilterKey, boolean][] = [
    ['branchId', Boolean(requestedBranchId)],
    ['producerIds', producerIds.length > 0],
    ['status', status.length > 0],
    ['policyTypes', policyTypes.length > 0],
    ['leadSourceIds', leadSourceIds.length > 0],
  ];
  const unsupported = requested
    .filter(([filter, given]) => given && !def.filters.includes(filter))
    .map(([filter]) => filter);
  if (unsupported.length) {
    throw new BadRequestException(
      `${unsupported.join(', ')} cannot filter ${def.label.toLowerCase()}`,
    );
  }

  if (status.length && def.status) {
    const unknown = status.filter(
      (value) => !def.status!.values.includes(value),
    );
    if (unknown.length) {
      throw new BadRequestException(
        `Unknown status ${unknown.join(', ')}; expected one of ${def.status.values.join(', ')}`,
      );
    }
  }

  // 1. Scope — the clamp every read starts from. Client-supplied filters
  //    below can only narrow it.
  const match: Record<string, unknown> =
    def.scope === 'producer'
      ? buildScopeFilter(access, branchId, { producerIds })
      : { ...clientScopeFilter(access), isTestRecord: { $ne: true } };

  // 2. Branch — honoured for an agency-scope caller only. The scope clamps
  //    ignore `X-Branch-Id` at agency scope; branch and own scope are
  //    already pinned, and a request cannot move them.
  if (access.dataScope === DataScope.Agency && requestedBranchId) {
    match.branchId = requestedBranchId;
  }

  if (status.length && def.status) {
    match[def.status.path] = {
      $in: [...new Set(status.flatMap(def.status.queryValues))],
    };
  }
  const policyTypeMatch = policyTypeValues(policyTypes);
  if (policyTypeMatch && def.policyTypePath) {
    match[def.policyTypePath] = { $in: policyTypeMatch };
  }

  const pipeline: PipelineStage[] = [
    { $match: match },
    ...dateWindowStages(
      dateField,
      query.from ?? undefined,
      query.to ?? undefined,
      access.timeZone,
    ),
  ];

  // 3. Lead source. A lead filters on its own field; a sale or a quote is
  //    credited through its lead, so its stages resolve `sourceId` for both
  //    the filter and the columns.
  if (def.leadSource?.kind === 'direct') {
    pipeline.push(...sourceMatch(leadSourceIds, 'leadSourceId'));
  } else if (def.leadSource?.kind === 'viaLead') {
    pipeline.push(
      ...sourceStages(def.leadSource.ownFallback),
      { $project: { _lead: 0 } },
      ...sourceMatch(leadSourceIds),
    );
  }

  pipeline.push(...(def.preStages?.() ?? []), { $sort: { _id: 1 } });

  return {
    def,
    agencyId,
    dateField,
    pipeline,
    branchId: typeof match.branchId === 'string' ? match.branchId : null,
    echo: {
      dateField: dateField.key,
      from: query.from ?? null,
      to: query.to ?? null,
      branchId: requestedBranchId,
      producerIds,
      status,
      policyTypes,
      leadSourceIds,
    },
  };
}

/** The pipeline minus its sort, ending in a `$count` — the rows it would write. */
export function countStages(plan: ExportPlan): PipelineStage[] {
  return [
    ...plan.pipeline.filter((stage) => !('$sort' in stage)),
    { $count: 'n' },
  ];
}
