import type { AnalyticsFilters } from "../filters/useAnalyticsFilters";
import { ServiceBreakdownPanel } from "./ServiceBreakdownPanel";
import { ServiceKpiRow } from "./ServiceKpiRow";
import { ServiceTrendPanel } from "./ServiceTrendPanel";

/** The service desk's numbers, under the same period and branch as Sales. */
export function ServiceTab({ filters }: { filters: AnalyticsFilters }) {
  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
      <ServiceKpiRow params={filters.serviceParams} />
      <ServiceBreakdownPanel params={filters.serviceParams} filters={filters} />
      <ServiceTrendPanel params={filters.serviceParams} filters={filters} />
    </div>
  );
}
