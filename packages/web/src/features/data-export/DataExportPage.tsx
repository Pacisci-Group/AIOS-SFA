import { useQuery } from "@tanstack/react-query";
import { AlertCircle, FileDown } from "lucide-react";
import {
  DATA_EXPORT_DATASET_KEYS,
  LEAD_SOURCE_NONE,
  POLICY_TYPES,
} from "@sfa/shared";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUrlState } from "@/hooks/useUrlState";
import { useLeadSources } from "@/hooks/useLeadSources";
import { parseUrlRange, toUrlRange } from "@/lib/date-range";
import {
  dataExportKey,
  getDataExportDictionary,
  getDataExportOptions,
  type DataExportDatasetKey,
  type DataExportFormat,
  type DataExportParams,
} from "@/lib/data-export-api";
import { ColumnPreview } from "./components/ColumnPreview";
import { DatasetList } from "./components/DatasetList";
import { ExportPanel, type ExportSelection } from "./components/ExportPanel";
import { RecentExports } from "./components/RecentExports";
import {
  EXPORT_RANGE_KEYS,
  resolveExportRange,
  type ExportRangeKey,
} from "./export-format";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** Every key the page keeps in the URL, so a filter set can be shared. */
const URL_DEFAULTS = {
  dataset: "",
  format: "",
  range: "",
  from: "",
  to: "",
  dateField: "",
  branchId: "",
  producerIds: [] as string[],
  status: [] as string[],
  policyTypes: [] as string[],
  leadSourceIds: [] as string[],
};

const URL_ALLOWED = {
  dataset: DATA_EXPORT_DATASET_KEYS,
  format: ["csv", "xlsx"],
  range: EXPORT_RANGE_KEYS,
  branchId: (value: string) => OBJECT_ID.test(value),
  producerIds: (value: string) => OBJECT_ID.test(value),
  policyTypes: POLICY_TYPES,
  leadSourceIds: (value: string) =>
    value === LEAD_SOURCE_NONE || OBJECT_ID.test(value),
} as const;

/**
 * The Data Export page (PAC-152): report-ready datasets for the data team's
 * own tools.
 *
 * Driven by the API's data dictionary — the datasets, which filters each
 * honours and every column — so a dataset added on the server appears here
 * without a web change. Gated by `data_export:read`, which the agency owner
 * grants from the role matrix; the server applies the caller's data scope to
 * every row regardless of what is selected here.
 */
export default function DataExportPage() {
  const [values, setValues] = useUrlState({
    defaults: URL_DEFAULTS,
    allowed: URL_ALLOWED,
  });

  const dictionary = useQuery({
    queryKey: [...dataExportKey, "datasets"],
    queryFn: getDataExportDictionary,
    staleTime: 10 * 60_000,
  });
  const options = useQuery({
    queryKey: [...dataExportKey, "options"],
    queryFn: getDataExportOptions,
    staleTime: 5 * 60_000,
  });
  // Optional: only `leads:read` or `owner_dashboard:read` may list sources,
  // and a caller with neither simply gets no source filter.
  const leadSources = useLeadSources();

  const datasets = dictionary.data?.datasets ?? [];
  const dataset =
    datasets.find((d) => d.key === values.dataset) ?? datasets[0] ?? null;

  const selection: ExportSelection = {
    range: parseUrlRange<ExportRangeKey>(
      { range: values.range || "all", from: values.from, to: values.to },
      "all",
    ),
    dateField: values.dateField,
    branchId: values.branchId,
    producerIds: values.producerIds,
    status: values.status,
    policyTypes: values.policyTypes,
    leadSourceIds: values.leadSourceIds,
    format: (values.format || "csv") as DataExportFormat,
  };

  const params = buildParams();

  /** The request this selection makes — only what the dataset honours. */
  function buildParams(): DataExportParams | null {
    if (!dataset) return null;
    const supports = (filter: (typeof dataset.filters)[number]) =>
      dataset.filters.includes(filter);
    const { from, to } = resolveExportRange(selection.range);
    const dateField = dataset.dateFields.some((f) => f.key === selection.dateField)
      ? selection.dateField
      : undefined;
    return {
      dataset: dataset.key,
      format: selection.format,
      from,
      to,
      dateField,
      // Only what this dataset honours: the API refuses anything else.
      branchId: supports("branchId") ? selection.branchId || undefined : undefined,
      producerIds: supports("producerIds") ? selection.producerIds : [],
      status: supports("status")
        ? selection.status.filter((s) => dataset.statusValues?.includes(s))
        : [],
      policyTypes: supports("policyTypes") ? selection.policyTypes : [],
      leadSourceIds: supports("leadSourceIds") ? selection.leadSourceIds : [],
    };
  }

  const onChange = (patch: Partial<ExportSelection>) => {
    const { range, ...rest } = patch;
    setValues({ ...rest, ...(range ? toUrlRange(range) : {}) });
  };

  const selectDataset = (key: DataExportDatasetKey) =>
    // Date fields and status values belong to a dataset; carry the rest over.
    setValues({ dataset: key, dateField: "", status: [] });

  return (
    <AppShell>
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <MobileNav className="-ml-1" />
          <div className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-primary sm:flex">
            <FileDown aria-hidden className="size-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              Data Export
            </h1>
            <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Report-ready datasets, prepared in the background
            </p>
          </div>
        </div>
      </header>

      <main className="w-full px-4 py-6 md:px-6">
        {dictionary.isError ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-5 py-16 text-center">
            <AlertCircle aria-hidden className="size-5 text-destructive" />
            <p className="text-sm text-muted-foreground">
              Could not load the datasets.
            </p>
            <Button variant="outline" size="sm" onClick={() => void dictionary.refetch()}>
              Retry
            </Button>
          </div>
        ) : !dataset || !params ? (
          <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
            <Skeleton className="h-96 w-full rounded-xl" />
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="lg:sticky lg:top-6 lg:self-start">
              <DatasetList
                datasets={datasets}
                selected={dataset.key}
                onSelect={selectDataset}
              />
            </aside>
            <div className="min-w-0 space-y-6">
              <ExportPanel
                dataset={dataset}
                selection={selection}
                onChange={onChange}
                params={params}
                options={options.data}
                leadSources={leadSources.data}
                maxRows={dictionary.data!.maxRows}
              />
              <ColumnPreview dataset={dataset} />
              <RecentExports />
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
