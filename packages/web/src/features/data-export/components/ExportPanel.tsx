import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileClock, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DATA_EXPORT_TOO_LARGE,
  LEAD_SOURCE_NONE,
  POLICY_TYPES,
  type LeadSourceOption,
} from "@sfa/shared";
import { DetailCard } from "@/components/common/DetailCard";
import { MultiSelect } from "@/components/common/MultiSelect";
import { RangeChips } from "@/components/common/RangeChips";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api-client";
import type { UrlRange } from "@/lib/date-range";
import {
  dataExportHistoryKey,
  requestDataExport,
  type DataExportDatasetDescriptor,
  type DataExportFormat,
  type DataExportOptionsResponse,
  type DataExportParams,
  type DataExportTooLargeError,
} from "@/lib/data-export-api";
import { cn } from "@/lib/utils";
import { EXPORT_RANGE_CHIPS, type ExportRangeKey } from "../export-format";

/** `branchId` in the URL is empty for "every branch"; Radix needs a real value. */
const ALL_BRANCHES = "all";

export interface ExportSelection {
  range: UrlRange<ExportRangeKey>;
  dateField: string;
  branchId: string;
  producerIds: string[];
  status: string[];
  policyTypes: string[];
  leadSourceIds: string[];
  format: DataExportFormat;
}

interface ExportPanelProps {
  dataset: DataExportDatasetDescriptor;
  selection: ExportSelection;
  onChange: (patch: Partial<ExportSelection>) => void;
  /** The resolved request — dates already worked out from the range chip. */
  params: DataExportParams;
  options: DataExportOptionsResponse | undefined;
  leadSources: readonly LeadSourceOption[] | undefined;
  maxRows: number;
}

const FORMATS: { value: DataExportFormat; label: string; icon: typeof FileText }[] = [
  { value: "csv", label: "CSV", icon: FileText },
  { value: "xlsx", label: "Excel", icon: FileSpreadsheet },
];

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as Partial<DataExportTooLargeError> | undefined;
    if (body?.code === DATA_EXPORT_TOO_LARGE) {
      return `This export has ${body.rowCount?.toLocaleString()} rows; the limit is ${body.maxRows?.toLocaleString()}. Narrow the date range or add a filter.`;
    }
    return error.message;
  }
  return "The export could not be requested. Try again.";
}

/**
 * The selected dataset: what goes into the file (range and filters) and the
 * one explicit action, Request export. Filters apply to the file, not to
 * anything on screen, so there is nothing to preview "live" — only the filters
 * this dataset honours are shown, because the API refuses any other.
 *
 * Requesting does not download. The export is queued, a worker writes the file
 * in the background, the requester is emailed, and the file is downloaded from
 * Recent exports below once it is ready — which is why success here is a toast
 * that says so rather than a file.
 */
export function ExportPanel({
  dataset,
  selection,
  onChange,
  params,
  options,
  leadSources,
  maxRows,
}: ExportPanelProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const supports = (filter: DataExportDatasetDescriptor["filters"][number]) =>
    dataset.filters.includes(filter);

  const request = useMutation({
    mutationFn: () => requestDataExport(params),
    onSuccess: (row) =>
      toast.success(`${row.datasetLabel} export requested`, {
        description: user?.email
          ? `We'll email ${user.email} when it's ready. You can download it from Recent exports below.`
          : "We'll email you when it's ready. You can download it from Recent exports below.",
      }),
    onError: (error) => toast.error(errorMessage(error)),
    // A refusal is logged too, so the history changes either way.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: dataExportHistoryKey }),
  });

  const branches = options?.branches ?? [];
  const producers = options?.producers ?? [];
  const dateFieldValue =
    selection.dateField ||
    dataset.dateFields.find((field) => field.isDefault)?.key ||
    "";

  return (
    <DetailCard
      title={dataset.label}
      subheading={
        <p className="mt-1 text-sm text-muted-foreground">{dataset.description}</p>
      }
    >
      <div className="space-y-5">
        <section className="space-y-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Date range
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <RangeChips
              chips={EXPORT_RANGE_CHIPS}
              range={selection.range}
              onChange={(range) => onChange({ range })}
              maxSpanDays={Number.POSITIVE_INFINITY}
            />
            {dataset.dateFields.length > 1 && (
              <Select
                value={dateFieldValue}
                onValueChange={(dateField) => onChange({ dateField })}
              >
                <SelectTrigger size="sm" className="w-48" aria-label="Date field">
                  <span className="text-muted-foreground">By</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dataset.dateFields.map((field) => (
                    <SelectItem key={field.key} value={field.key}>
                      {field.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Filters
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {supports("branchId") && branches.length > 1 && (
              <Select
                value={selection.branchId || ALL_BRANCHES}
                onValueChange={(value) =>
                  onChange({ branchId: value === ALL_BRANCHES ? "" : value })
                }
              >
                <SelectTrigger size="sm" className="w-44" aria-label="Branch">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {supports("producerIds") && producers.length > 1 && (
              <MultiSelect
                options={producers.map((p) => ({ value: p.id, label: p.name }))}
                value={selection.producerIds}
                onChange={(producerIds) => onChange({ producerIds })}
                placeholder="All producers"
                summarize={(n) => `${n} producers`}
                className="w-44"
              />
            )}
            {supports("status") && dataset.statusValues?.length ? (
              <MultiSelect
                options={dataset.statusValues.map((s) => ({ value: s, label: s }))}
                value={selection.status}
                onChange={(status) => onChange({ status })}
                placeholder="All statuses"
                summarize={(n) => `${n} statuses`}
                className="w-40"
              />
            ) : null}
            {supports("policyTypes") && (
              <MultiSelect
                options={POLICY_TYPES.map((t) => ({ value: t, label: t }))}
                value={selection.policyTypes}
                onChange={(policyTypes) => onChange({ policyTypes })}
                placeholder="All lines"
                summarize={(n) => `${n} lines`}
                className="w-40"
              />
            )}
            {supports("leadSourceIds") && leadSources?.length ? (
              <MultiSelect
                options={[
                  ...leadSources.map((s) => ({ value: s.id, label: s.name })),
                  { value: LEAD_SOURCE_NONE, label: "No source" },
                ]}
                value={selection.leadSourceIds}
                onChange={(leadSourceIds) => onChange({ leadSourceIds })}
                placeholder="All sources"
                summarize={(n) => `${n} sources`}
                className="w-40"
              />
            ) : null}
          </div>
        </section>

        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div
            role="group"
            aria-label="File format"
            className="flex w-fit items-center gap-1 rounded-lg bg-muted p-1"
          >
            {FORMATS.map(({ value, label, icon: Icon }) => {
              const active = selection.format === value;
              return (
                <Button
                  key={value}
                  size="sm"
                  variant="ghost"
                  aria-pressed={active}
                  onClick={() => onChange({ format: value })}
                  className={cn(
                    "h-7",
                    active
                      ? "bg-background font-semibold text-primary shadow-xs hover:bg-background"
                      : "text-muted-foreground",
                  )}
                >
                  <Icon aria-hidden className="size-4" />
                  {label}
                </Button>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground">
              Up to {maxRows.toLocaleString()} rows
            </p>
            <Button onClick={() => request.mutate()} disabled={request.isPending}>
              {request.isPending ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <FileClock aria-hidden className="size-4" />
              )}
              {request.isPending ? "Requesting…" : "Request export"}
            </Button>
          </div>
        </div>
      </div>
    </DetailCard>
  );
}
