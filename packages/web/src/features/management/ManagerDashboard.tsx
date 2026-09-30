import { MANAGEMENT_DRAWER_KEYS } from "@sfa/shared";
import type { ManagementDrawerKey } from "@sfa/shared";
import { useCallback } from "react";
import { useUrlState } from "@/hooks/useUrlState";
import { AlertCards } from "./components/AlertCards";
import { AlertDrawer } from "./components/AlertDrawer";
import { ProducerDrawer } from "./components/ProducerDrawer";
import { TeamActivityTable } from "./components/TeamActivityTable";
import { DashboardFilterBar } from "./filters/DashboardFilterBar";
import { useDashboardFilters } from "./filters/useDashboardFilters";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** Frozen so `useUrlState`'s memo dependencies stay stable across renders. */
const DRAWER_DEFAULTS = { drawer: "", producer: "" };
const DRAWER_ALLOWED = {
  drawer: MANAGEMENT_DRAWER_KEYS,
  producer: (value: string) => OBJECT_ID.test(value),
} as const;

/**
 * The Manager View — "Action Hub" (PAC-139): a read-only summary for the
 * office manager. "This is not actionable information … this is to tell if
 * all of our data is flowing like it's supposed to be flowing" (David, 22 Sep).
 *
 * One filter, three self-fetching units — the alert cards, the Team Activity
 * table, and whichever drawer is open — each owning its query so one failing
 * leaves the others standing. The filter is the Owner view's, from the same
 * bar (`useDashboardFilters`); what each filter reaches is stated on the unit
 * it reaches.
 *
 * Which drawer is open is URL state too (`?drawer=stalled`, `?producer=<id>`),
 * so a manager can paste "look at these" to a colleague — the same reason the
 * filter lives there. Deliberately not on this page: the mockup's "Live" pill
 * and any auto-refresh (nothing here is a feed), and "Calls Today" (nothing
 * tracks calls, and David will not rely on producers logging them).
 */
export function ManagerDashboard() {
  const { range, params, setRange, setFilter, clearFilters, activeCount } =
    useDashboardFilters();

  const [{ drawer, producer }, setDrawers] = useUrlState({
    defaults: DRAWER_DEFAULTS,
    allowed: DRAWER_ALLOWED,
  });

  const openDrawer = useCallback(
    (key: ManagementDrawerKey) => setDrawers({ drawer: key, producer: "" }),
    [setDrawers],
  );
  const openProducer = useCallback(
    (producerId: string) => setDrawers({ producer: producerId, drawer: "" }),
    [setDrawers],
  );
  const closeDrawers = useCallback(
    () => setDrawers({ drawer: "", producer: "" }),
    [setDrawers],
  );

  return (
    <>
      <DashboardFilterBar
        range={range}
        params={params}
        onRangeChange={setRange}
        onFilterChange={setFilter}
        onClear={clearFilters}
        activeCount={activeCount}
      />

      <div className="flex flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
        <AlertCards params={params} onOpen={openDrawer} />
        <TeamActivityTable params={params} onSelect={openProducer} />
      </div>

      <AlertDrawer
        open={(drawer || null) as ManagementDrawerKey | null}
        params={params}
        onClose={closeDrawers}
      />
      <ProducerDrawer
        producerId={producer || null}
        params={params}
        onClose={closeDrawers}
      />
    </>
  );
}
