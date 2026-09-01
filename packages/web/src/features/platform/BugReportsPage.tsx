import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bug, ImageIcon, Loader2, Search } from "lucide-react";
import {
  BUG_REPORT_STATUSES,
  BUG_REPORT_STATUS_LABELS,
  BUG_SEVERITIES,
  BUG_SEVERITY_LABELS,
  OPEN_BUG_REPORT_STATUSES,
  type BugReportStatus,
  type BugSeverity,
} from "@sfa/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { listAgencies } from "@/lib/platform-api";
import { listBugReports } from "@/lib/platform-bug-reports-api";
import { cn } from "@/lib/utils";
import { SuperAdminLayout } from "./SuperAdminLayout";
import { BugReportDetailSheet } from "./components/BugReportDetailSheet";
import {
  BUG_SEVERITY_SHORT,
  BUG_SEVERITY_VARIANT,
  BUG_STATUS_VARIANT,
  relativeTime,
} from "./components/bug-report-display";

/** Sentinel for "no filter" — `Select` cannot take an empty-string value. */
const ANY = "__any__";

/**
 * The status filter's three presets.
 *
 * `open` is the default because a triage queue's job is to show what still
 * needs doing; a list that opens on 400 resolved reports is one nobody scrolls.
 */
type StatusPreset = "open" | "all" | BugReportStatus;

function presetToStatuses(preset: StatusPreset): BugReportStatus[] | undefined {
  if (preset === "all") return undefined;
  if (preset === "open") return [...OPEN_BUG_REPORT_STATUSES];
  return [preset];
}

/**
 * The Super Admin bug queue.
 *
 * Cross-tenant: every report filed from the floating widget on any surface
 * lands here, including ones filed from the panel itself (a platform operator
 * has no agency, and those rows read "Platform").
 *
 * Filtering is **real-time** — no Apply button, per the cross-cutting product
 * rule in AGENTS.md §7. Search is debounced because it hits a Mongo text index
 * on every keystroke otherwise.
 */
export default function BugReportsPage() {
  const [preset, setPreset] = useState<StatusPreset>("open");
  const [severity, setSeverity] = useState<string>(ANY);
  const [agencyId, setAgencyId] = useState<string>(ANY);
  const [search, setSearch] = useState("");
  const [openReportId, setOpenReportId] = useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(search);

  const agenciesQuery = useQuery({
    queryKey: ["platform", "agencies"],
    queryFn: listAgencies,
  });

  const filters = {
    status: presetToStatuses(preset),
    severity: severity === ANY ? undefined : (severity as BugSeverity),
    agencyId: agencyId === ANY ? undefined : agencyId,
    search: debouncedSearch || undefined,
  };

  const query = useQuery({
    queryKey: ["platform", "bug-reports", filters],
    queryFn: () => listBugReports(filters),
    // Keeps the previous page on screen while a filter change is in flight,
    // instead of flashing the empty state between every keystroke.
    placeholderData: (previous) => previous,
  });

  const data = query.data;
  const items = data?.items ?? [];
  const counts = data?.statusCounts;
  const openCount = counts
    ? OPEN_BUG_REPORT_STATUSES.reduce((sum, key) => sum + counts[key], 0)
    : null;

  return (
    <SuperAdminLayout>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2 gap-1">
        <Link to="/admin">
          <ArrowLeft className="size-4" />
          All areas
        </Link>
      </Button>

      <div className="mb-6">
        <h2 className="text-sm font-semibold text-card-foreground">
          Bug reports
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything filed from the in-app "Report a bug" button, across every
          agency.
        </p>
      </div>

      {/* Status presets. Counts come from the unfiltered collection, so they
          stay meaningful whatever else is selected. */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <StatusChip
          active={preset === "open"}
          count={openCount}
          onClick={() => setPreset("open")}
        >
          Open
        </StatusChip>
        {BUG_REPORT_STATUSES.map((status) => (
          <StatusChip
            key={status}
            active={preset === status}
            count={counts ? counts[status] : null}
            onClick={() => setPreset(status)}
          >
            {BUG_REPORT_STATUS_LABELS[status]}
          </StatusChip>
        ))}
        <StatusChip
          active={preset === "all"}
          count={
            counts
              ? Object.values(counts).reduce((sum, value) => sum + value, 0)
              : null
          }
          onClick={() => setPreset("all")}
        >
          All
        </StatusChip>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search descriptions…"
            aria-label="Search bug reports"
            className="pl-8"
          />
        </div>

        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-44" aria-label="Filter by severity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any severity</SelectItem>
            {BUG_SEVERITIES.map((value) => (
              <SelectItem key={value} value={value}>
                {BUG_SEVERITY_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={agencyId} onValueChange={setAgencyId}>
          <SelectTrigger className="w-48" aria-label="Filter by agency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any agency</SelectItem>
            {(agenciesQuery.data ?? []).map((agency) => (
              <SelectItem key={agency._id} value={agency._id}>
                {agency.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {query.isPending && (
            <div className="flex items-center gap-2 px-5 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading reports…
            </div>
          )}

          {query.isError && (
            <p className="px-5 py-10 text-sm text-destructive">
              {(query.error as Error).message}
            </p>
          )}

          {!query.isPending && !query.isError && items.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
              <Bug className="size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {debouncedSearch || preset !== "open" || severity !== ANY
                  ? "No reports match these filters."
                  : "No open bug reports. "}
              </p>
            </div>
          )}

          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setOpenReportId(item.id)}
                  className="flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <Badge
                    size="sm"
                    variant={BUG_SEVERITY_VARIANT[item.severity]}
                    className="mt-0.5 shrink-0"
                  >
                    {BUG_SEVERITY_SHORT[item.severity]}
                  </Badge>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base text-foreground">
                      {item.summary}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {item.reporterName ?? item.reporterEmail}
                      {" · "}
                      {item.agencyName ?? "Platform"}
                      {" · "}
                      {relativeTime(item.createdAt)}
                    </p>
                  </div>

                  {item.screenshotCount > 0 && (
                    <span className="mt-0.5 flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <ImageIcon className="size-3" />
                      <span className="tabular-nums">
                        {item.screenshotCount}
                      </span>
                    </span>
                  )}

                  <Badge
                    size="sm"
                    variant={BUG_STATUS_VARIANT[item.status]}
                    className="mt-0.5 shrink-0"
                  >
                    {BUG_REPORT_STATUS_LABELS[item.status]}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {data && items.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Showing {items.length} of {data.total}
          {data.total > items.length && " — narrow the filters to see the rest."}
        </p>
      )}

      <BugReportDetailSheet
        reportId={openReportId}
        onClose={() => setOpenReportId(null)}
      />
    </SuperAdminLayout>
  );
}

/** A filter preset pill. `Button` per the "every clickable thing" rule. */
function StatusChip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number | null;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "secondary" : "ghost"}
      onClick={onClick}
      className={cn("h-7 gap-1.5 px-2.5 text-xs", active && "font-semibold")}
    >
      {children}
      {count !== null && (
        <span className="tabular-nums text-muted-foreground">{count}</span>
      )}
    </Button>
  );
}
