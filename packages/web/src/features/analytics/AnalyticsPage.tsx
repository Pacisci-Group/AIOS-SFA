import { useQuery } from "@tanstack/react-query";
import { ChartColumn } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { analyticsKey, getAnalyticsOptions } from "@/lib/analytics-api";
import { AnalyticsFilterBar } from "./filters/AnalyticsFilterBar";
import { useAnalyticsFilters } from "./filters/useAnalyticsFilters";
import { SalesTab } from "./sales/SalesTab";
import { ServiceTab } from "./service/ServiceTab";

/**
 * The Analytics page (PAC-152, part 2) — sales and service, by any dimension,
 * over any period. Modelled on AgencyZoom's Reports for its flexibility
 * ("Sales by Producer / Lead Source / Policy Line / …", the Service Center),
 * not for its look.
 *
 * Gated by `analytics:read`: the agency owner holds it through enabled
 * modules, the branch manager by template, and the owner grants it to anyone
 * else. The server applies the caller's data scope to every figure — a branch
 * manager sees their branch, a producer granted the page their own sales —
 * whatever the filters say.
 *
 * Everything lives in the URL (tab, period, filters, how each panel is cut),
 * so a view survives a refresh and can be sent to someone. Filtering is
 * instant; there is no Apply button.
 */
export default function AnalyticsPage() {
  const filters = useAnalyticsFilters();
  const options = useQuery({
    queryKey: [...analyticsKey, "options"],
    queryFn: getAnalyticsOptions,
    staleTime: 5 * 60_000,
  });
  const { view, setValues } = filters;

  return (
    <AppShell>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <MobileNav className="-ml-1" />
          <ChartColumn aria-hidden className="size-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">Analytics</h1>
            <p className="truncate text-sm text-muted-foreground">
              {view.tab === "sales"
                ? "Sales by any dimension, over any period"
                : "Service requests opened, resolved and still open"}
            </p>
          </div>
        </div>

        <Tabs
          value={view.tab}
          // Sales is the default, so it is written as "no param".
          onValueChange={(next) =>
            setValues({ view: next === "service" ? "service" : "" })
          }
        >
          <TabsList>
            <TabsTrigger value="sales">Sales</TabsTrigger>
            <TabsTrigger value="service">Service</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      <AnalyticsFilterBar filters={filters} options={options.data} />

      <div className="flex-1">
        {view.tab === "sales" ? (
          <SalesTab filters={filters} />
        ) : (
          <ServiceTab filters={filters} />
        )}
      </div>
    </AppShell>
  );
}
