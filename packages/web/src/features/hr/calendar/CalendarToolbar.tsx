import type { HrCalendarFilters } from "@sfa/shared";
import { MultiSelect } from "@/components/common/MultiSelect";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CALENDAR_LAYERS,
  LAYER_META,
  type CalendarLayer,
} from "./calendar-display";

interface CalendarToolbarProps {
  hidden: ReadonlySet<CalendarLayer>;
  onToggle: (layer: CalendarLayer) => void;
  /** Both lists are empty for someone who sees only their own time off. */
  filters: HrCalendarFilters | undefined;
  branchIds: readonly string[];
  employeeIds: readonly string[];
  onFilter: (patch: { branch?: string[]; employee?: string[] }) => void;
}

/**
 * Above the calendar (PAC-169): the layer chips, which are also the legend —
 * each shows its layer's colour and icon and switches it off and on — and,
 * for someone who sees a team, the branch and employee filters.
 *
 * Layers are hidden in the browser: the read already returned them, and
 * hiding birthdays is a matter of taste, not of data. The filters go to the
 * server, because they narrow whose time off is read at all.
 */
export function CalendarToolbar({
  hidden,
  onToggle,
  filters,
  branchIds,
  employeeIds,
  onFilter,
}: CalendarToolbarProps) {
  const branches = filters?.branches ?? [];
  const people = filters?.people ?? [];
  // Choosing branches first narrows the people offered to those branches.
  const offered = branchIds.length
    ? people.filter(
        (person) => person.branchId && branchIds.includes(person.branchId),
      )
    : people;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div
        role="group"
        aria-label="Show on the calendar"
        className="flex flex-wrap gap-2"
      >
        {CALENDAR_LAYERS.map((layer) => {
          const { label, icon: Icon, color } = LAYER_META[layer];
          const shown = !hidden.has(layer);
          return (
            <Button
              key={layer}
              type="button"
              size="sm"
              variant="outline"
              aria-pressed={shown}
              onClick={() => onToggle(layer)}
              className={cn(
                "gap-2",
                !shown && "text-muted-foreground opacity-60",
              )}
            >
              <span
                aria-hidden
                className="size-2.5 rounded-full"
                style={{
                  backgroundColor: shown ? color : "transparent",
                  outline: `1px solid ${color}`,
                }}
              />
              <Icon aria-hidden />
              {label}
            </Button>
          );
        })}
      </div>

      {people.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {branches.length > 1 && (
            <MultiSelect
              options={branches.map((branch) => ({
                value: branch.id,
                label: branch.name,
              }))}
              value={branchIds}
              onChange={(branch) => onFilter({ branch })}
              placeholder="All branches"
              summarize={(count) => `${count} branches`}
              className="min-w-36"
              align="end"
            />
          )}
          <MultiSelect
            options={offered.map((person) => ({
              value: person.id,
              label: person.name,
            }))}
            value={employeeIds}
            onChange={(employee) => onFilter({ employee })}
            placeholder="Everyone"
            summarize={(count) => `${count} people`}
            className="min-w-36"
            align="end"
          />
        </div>
      )}
    </div>
  );
}
