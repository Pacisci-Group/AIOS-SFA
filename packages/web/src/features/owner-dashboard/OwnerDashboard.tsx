import { LeadSourceMatrix } from "./components/LeadSourceMatrix";
import { OwnerFilterBar } from "./components/OwnerFilterBar";
import { OwnerKpiRow } from "./components/OwnerKpiRow";
import { ProducerLeaderboard } from "./components/ProducerLeaderboard";
import { useOwnerFilters } from "./useOwnerFilters";

/**
 * The Owner View — "Strategy Hub" (PAC-135): a compilation of everything going
 * on in the agency, for whoever owns it.
 *
 * One filter, three self-fetching units. The filter lives here (in the URL) and
 * is handed to each unit whole; nothing below this component holds filter
 * state of its own. Each unit owns its query so one failing leaves the others
 * standing — and because all three send the same filter, the leaderboard total,
 * the lead-source total and the Total Bound Premium card always agree.
 *
 * Left out of v1, deliberately — see each component's docblock for the why:
 * the premium sparkline (needs a month-by-month feed nobody asked for), the
 * closing-ratio progress bar (the ratio can exceed 100%), On track / Lagging
 * (judged against goals that do not exist yet), and the "All Offices" selector
 * (branches are PAC-90).
 */
export function OwnerDashboard() {
  const { range, params, setRange, setFilter, clearFilters, activeCount } =
    useOwnerFilters();

  return (
    <>
      <OwnerFilterBar
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
         * 60/40, stacked below `xl` — the leaderboard needs its six columns.
         * The two panels stretch to the taller one (grid's default): the row
         * counts differ and move with every filter, and two cards whose bottom
         * edges wander apart read as a layout bug rather than as data.
         */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[3fr_2fr]">
          <ProducerLeaderboard params={params} />
          <LeadSourceMatrix params={params} />
        </div>
      </div>
    </>
  );
}
