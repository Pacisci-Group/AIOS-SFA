import { LEAD_SOURCE_NONE, POLICY_TYPES } from "@sfa/shared";
import { X } from "lucide-react";
import { useMemo } from "react";
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
import { useLeadSources } from "@/hooks/useLeadSources";
import type { AnalyticsOptionsResponse } from "@/lib/analytics-api";
import { ANALYTICS_RANGE_CHIPS } from "./analytics-range";
import type { AnalyticsFilters } from "./useAnalyticsFilters";

/** `branchId` is empty for "every branch"; Radix needs a real value. */
const ALL_BRANCHES = "all";

/** See `DashboardFilterBar`: two to a line on a phone, fixed widths from `sm`. */
const SELECT_WIDTH = "min-w-40 flex-1 sm:w-44 sm:flex-none";

const POLICY_TYPE_OPTIONS = POLICY_TYPES.map((type) => ({
  value: type,
  label: type,
}));

/**
 * The period chips and the filters (PAC-152, part 2). The management
 * dashboards' bar, plus a branch picker for an owner with more than one
 * office and a carrier filter, and — on the Service tab — the assignee in
 * place of the producer, since a ticket is worked by whoever holds it.
 *
 * The lists come from `GET /analytics/options`, behind the page's own
 * permission, so a producer granted the page can filter without the agency
 * directory. A branch- or own-scope caller is offered one branch, so the
 * picker is not shown at all.
 */
export function AnalyticsFilterBar({
  filters,
  options,
}: {
  filters: AnalyticsFilters;
  options: AnalyticsOptionsResponse | undefined;
}) {
  const { values, setValues, range, setRange, view, activeCount, clearFilters } =
    filters;
  const sales = view.tab === "sales";
  const leadSources = useLeadSources({ enabled: sales });

  const producerOptions = useMemo(
    () => (options?.producers ?? []).map((p) => ({ value: p.id, label: p.name })),
    [options],
  );
  const assigneeOptions = useMemo(
    () => (options?.assignees ?? []).map((p) => ({ value: p.id, label: p.name })),
    [options],
  );
  const carrierOptions = useMemo(
    () => (options?.carriers ?? []).map((c) => ({ value: c, label: c })),
    [options],
  );
  const leadSourceOptions = useMemo(
    () => [
      ...(leadSources.data ?? []).map((s) => ({ value: s.id, label: s.name })),
      { value: LEAD_SOURCE_NONE, label: "No source" },
    ],
    [leadSources.data],
  );
  const branches = options?.branches ?? [];

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-4 py-3 md:px-6">
      <RangeChips
        chips={ANALYTICS_RANGE_CHIPS}
        range={range}
        onChange={setRange}
      />

      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        {branches.length > 1 && (
          <Select
            value={values.branchId || ALL_BRANCHES}
            onValueChange={(value) =>
              setValues({ branchId: value === ALL_BRANCHES ? "" : value })
            }
          >
            <SelectTrigger size="sm" className={SELECT_WIDTH} aria-label="Branch">
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
        {sales ? (
          <>
            {producerOptions.length > 1 && (
              <MultiSelect
                options={producerOptions}
                value={values.producerIds}
                onChange={(producerIds) => setValues({ producerIds })}
                placeholder="All producers"
                summarize={(n) => `${n} producers`}
                className={SELECT_WIDTH}
              />
            )}
            <MultiSelect
              options={leadSourceOptions}
              value={values.leadSourceIds}
              onChange={(leadSourceIds) => setValues({ leadSourceIds })}
              placeholder="All lead sources"
              summarize={(n) => `${n} lead sources`}
              className={SELECT_WIDTH}
            />
          </>
        ) : (
          assigneeOptions.length > 0 && (
            <MultiSelect
              options={assigneeOptions}
              value={values.assigneeIds}
              onChange={(assigneeIds) => setValues({ assigneeIds })}
              placeholder="All assignees"
              summarize={(n) => `${n} assignees`}
              className={SELECT_WIDTH}
            />
          )
        )}
        <MultiSelect
          options={POLICY_TYPE_OPTIONS}
          value={values.policyTypes}
          onChange={(policyTypes) => setValues({ policyTypes })}
          placeholder="All lines"
          summarize={(n) => `${n} lines`}
          className={SELECT_WIDTH}
          align="end"
        />
        {sales && carrierOptions.length > 0 && (
          <MultiSelect
            options={carrierOptions}
            value={values.carriers}
            onChange={(carriers) => setValues({ carriers })}
            placeholder="All carriers"
            summarize={(n) => `${n} carriers`}
            className={SELECT_WIDTH}
            align="end"
          />
        )}
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X aria-hidden />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
