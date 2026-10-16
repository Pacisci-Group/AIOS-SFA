import { PRODUCER_NONE } from "@sfa/shared";
import { useCallback, useState } from "react";
import { LeadSourceMatrix } from "./components/LeadSourceMatrix";
import { OpenQuotesDrawer } from "./components/OpenQuotesDrawer";
import { OwnerKpiRow } from "./components/OwnerKpiRow";
import { ProducerLeaderboard } from "./components/ProducerLeaderboard";
import {
  ProducerQuotesTable,
  type QuotesProducer,
} from "./components/ProducerQuotesTable";
import { DashboardFilterBar } from "@/features/management/filters/DashboardFilterBar";
import { useDashboardFilters } from "@/features/management/filters/useDashboardFilters";
import { useUrlState } from "@/hooks/useUrlState";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * The open-quotes drawer's producer, in the URL so an open drawer survives a
 * reload and can be shared. Not `producer`: the Manager view's drawer uses that
 * key on the same page.
 */
const DRAWER_DEFAULTS = { quotesProducer: "" };
const DRAWER_ALLOWED = {
  quotesProducer: (value: string) =>
    value === PRODUCER_NONE || OBJECT_ID.test(value),
} as const;

/**
 * The Owner View — "Strategy Hub" (PAC-135): a compilation of everything going
 * on in the agency, for whoever owns it.
 *
 * One filter, four self-fetching units and a drawer. The filter lives here (in
 * the URL) and is handed to each unit whole; nothing below this component holds
 * filter state of its own. Each unit owns its query so one failing leaves the
 * others standing — and because all of them send the same filter, the
 * leaderboard total, the lead-source total and the Total Bound Premium card
 * always agree, as do the quotes the leaderboard, the closing-ratio card and
 * the Quotes by producer card count.
 *
 * Quotes by producer (Oct 2026) sits full width under the two tables, as David
 * asked ("another card needs to be at the bottom"); clicking a producer opens
 * their open quotes in a drawer.
 *
 * Left out of v1, deliberately — see each component's docblock for the why:
 * the premium sparkline (needs a month-by-month feed nobody asked for), the
 * closing-ratio progress bar (the ratio can exceed 100%), On track / Lagging
 * (judged against goals that do not exist yet), and the "All Offices" selector
 * (branches are PAC-90).
 */
export function OwnerDashboard() {
  const { range, params, setRange, setFilter, clearFilters, activeCount } =
    useDashboardFilters();

  const [{ quotesProducer }, setDrawer] = useUrlState({
    defaults: DRAWER_DEFAULTS,
    allowed: DRAWER_ALLOWED,
  });
  // The clicked row's name, to title the drawer before its first page lands.
  const [pickedName, setPickedName] = useState<string>();
  const openQuotes = useCallback(
    (producer: QuotesProducer) => {
      setPickedName(producer.name);
      setDrawer({ quotesProducer: producer.id });
    },
    [setDrawer],
  );
  const closeQuotes = useCallback(
    () => setDrawer({ quotesProducer: "" }),
    [setDrawer],
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
        <OwnerKpiRow params={params} />

        {/*
         * 60/40, stacked below `2xl`. Side by side, the leaderboard's table
         * needs ~720px and the lead-source table ~480px; below `2xl` the sidebar
         * leaves less than that, and each panel falls back to its stacked list
         * at the width where its table stops fitting (see the `@container` in
         * each). It was `xl`, where the pair needed ~1,280px of a ~1,000px row.
         *
         * `minmax(0, …)`, not a bare `3fr`: an `fr` track's minimum is `auto`,
         * i.e. its content's width, so a wide table stretched its track past
         * the grid and pushed the whole page off the right edge of the screen.
         *
         * The two panels stretch to the taller one (grid's default): the row
         * counts differ and move with every filter, and two cards whose bottom
         * edges wander apart read as a layout bug rather than as data.
         */}
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <ProducerLeaderboard params={params} />
          <LeadSourceMatrix params={params} />
        </div>

        <ProducerQuotesTable params={params} onSelect={openQuotes} />
      </div>

      <OpenQuotesDrawer
        producer={quotesProducer || null}
        fallbackName={pickedName}
        params={params}
        onClose={closeQuotes}
      />
    </>
  );
}
