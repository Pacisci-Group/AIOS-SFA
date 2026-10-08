import type { AnalyticsFilters } from "../filters/useAnalyticsFilters";
import { SalesBreakdownPanel } from "./SalesBreakdownPanel";
import { SalesKpiRow } from "./SalesKpiRow";
import { SalesTrendPanel } from "./SalesTrendPanel";

/** KPIs, then the breakdown, then the trend — each its own request. */
export function SalesTab({ filters }: { filters: AnalyticsFilters }) {
  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
      <SalesKpiRow params={filters.salesParams} />
      <SalesBreakdownPanel params={filters.salesParams} filters={filters} />
      <SalesTrendPanel params={filters.salesParams} filters={filters} />
    </div>
  );
}
