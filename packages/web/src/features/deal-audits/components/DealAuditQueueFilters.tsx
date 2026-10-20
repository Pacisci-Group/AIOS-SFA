import { Clock, X } from "lucide-react";
import { useMemo } from "react";
import { DisabledHint } from "@/components/common/DisabledHint";
import { MultiSelect } from "@/components/common/MultiSelect";
import { RangeChips } from "@/components/common/RangeChips";
import { TableSearchInput } from "@/components/common/TableSearchInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  DealAuditQueueOptionsResponse,
  DealAuditQueueSort,
} from "@/lib/deal-audits-api";
import { cn } from "@/lib/utils";
import {
  POLICY_TYPE_OPTIONS,
  QUEUE_RANGE_CHIPS,
  QUEUE_SORT_OPTIONS,
} from "../queue-filters";
import type { DealAuditsUrlState } from "../useDealAuditsUrlState";
import { SENT_BACK_TEXT } from "./review-display";

/**
 * Below `sm` a select grows to share its row; `min-w-40` is what breaks the
 * row two to a line on a phone (a `flex-1` item's basis is zero, so wrapping
 * is decided on its minimum). The `DashboardFilterBar` rule.
 */
const SELECT_WIDTH = "min-w-40 flex-1 sm:w-44 sm:flex-none";

/**
 * The Deal Audits queue's search, filters and sort (20 Oct 2026).
 *
 * The page's existing pieces, in the repo's existing shapes: the omni box and
 * sort `Select` of the Clients page, then the dashboards' period chips and
 * multi-selects. Instant — no Apply — and everything in the URL
 * (`useDealAuditsUrlState`).
 *
 * The producer list comes from the queue's own options route, so a manager
 * without `agency:users:read` can still filter by producer. While it loads the
 * select is there with no options rather than missing, so the bar does not
 * shift when it arrives.
 */
export function DealAuditQueueFilters({
  state,
  producers,
  busy,
}: {
  state: DealAuditsUrlState;
  producers: DealAuditQueueOptionsResponse["producers"];
  busy: boolean;
}) {
  const producerOptions = useMemo(
    () => producers.map((producer) => ({ value: producer.id, label: producer.name })),
    [producers],
  );
  // An approved audit is never aging; the chip switches the toggle off.
  const agingUnavailable = state.status === "pass";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1">
          <TableSearchInput
            value={state.search}
            onValueChange={state.setSearch}
            placeholder="Search by client, producer or policy number…"
            label="Search deal audits"
            busy={busy}
          />
        </div>
        <Select
          value={state.sort}
          onValueChange={(value) => state.setSort(value as DealAuditQueueSort)}
        >
          <SelectTrigger
            className="flex-1 border-border bg-card md:w-[190px] md:flex-none"
            aria-label="Sort deal audits"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUEUE_SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <RangeChips
          chips={QUEUE_RANGE_CHIPS}
          range={state.range}
          onChange={state.setRange}
        />

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <MultiSelect
            options={producerOptions}
            value={state.producerIds}
            onChange={state.setProducerIds}
            placeholder="All producers"
            summarize={(count) => `${count} producers`}
            className={SELECT_WIDTH}
          />
          <MultiSelect
            options={POLICY_TYPE_OPTIONS}
            value={state.policyTypes}
            onChange={state.setPolicyTypes}
            placeholder="All lines"
            summarize={(count) => `${count} lines`}
            className={SELECT_WIDTH}
            align="end"
          />
          <DisabledHint
            hint={
              agingUnavailable
                ? "An approved audit is never aging."
                : undefined
            }
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={state.aging}
              disabled={agingUnavailable}
              onClick={() => state.setAging(!state.aging)}
              className={cn(
                state.aging &&
                  cn(
                    "border-red-500/30 bg-red-500/12 hover:bg-red-500/16",
                    SENT_BACK_TEXT,
                  ),
              )}
            >
              <Clock aria-hidden />
              Aging only
            </Button>
          </DisabledHint>
          {state.activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={state.clearFilters}>
              <X aria-hidden />
              Clear
              <Badge
                size="sm"
                className="bg-primary/12 px-1.5 font-semibold text-primary"
              >
                {state.activeCount}
              </Badge>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
