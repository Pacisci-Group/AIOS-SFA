import { Search, SlidersHorizontal } from "lucide-react";
import { MultiSelect } from "@/components/common/MultiSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  countActiveFilters,
  HOUSEHOLD_SORT_OPTIONS,
  HOUSEHOLD_STATUS_OPTIONS,
  type HouseholdFilters,
  type HouseholdSort,
} from "./household-filters";

interface HouseholdsSearchProps {
  search: string;
  onSearchChange: (value: string) => void;
  filters: HouseholdFilters;
  onChange: (patch: Partial<HouseholdFilters>) => void;
  onClear: () => void;
  sort: HouseholdSort;
  onSortChange: (sort: HouseholdSort) => void;
}

/**
 * The Clients search bar: one omni box, the status facet, sort, and a popover
 * holding the five identifier fields.
 *
 * The split is the point. Most of the time somebody has *one* identifier and
 * does not want to think about which box it belongs in — the omni box routes it
 * by shape server-side, so `HH-2614`, `03/12/1985` and a policy number all just
 * work. The popover is for the rarer case of combining two, where ANDing beats
 * a single term that has to match everything at once.
 *
 * Every control applies on change; there is no Apply button, per the project's
 * real-time faceted filtering rule.
 */
export function HouseholdsSearch({
  search,
  onSearchChange,
  filters,
  onChange,
  onClear,
  sort,
  onSortChange,
}: HouseholdsSearchProps) {
  const activeCount = countActiveFilters(filters);

  return (
    <div className="flex flex-col gap-3 mb-5 md:flex-row md:items-center">
      <div className="relative flex-1 min-w-0">
        <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by name, date of birth, HH- number, or policy number…"
          className="pl-9 bg-card border-border"
        />
      </div>

      <div className="flex items-center gap-2">
        <MultiSelect
          options={HOUSEHOLD_STATUS_OPTIONS}
          value={filters.status}
          onChange={(status) => onChange({ status })}
          placeholder="All statuses"
          summarize={(count) => `${count} statuses`}
          className="flex-1 md:w-[150px] md:flex-none"
        />

        <Select
          value={sort}
          onValueChange={(value) => onSortChange(value as HouseholdSort)}
        >
          <SelectTrigger className="flex-1 md:w-[170px] md:flex-none bg-card border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HOUSEHOLD_SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="shrink-0 bg-card border-border"
            >
              <SlidersHorizontal className="size-4" />
              <span className="hidden sm:inline">Fields</span>
              {activeCount > 0 && (
                <Badge
                  size="sm"
                  className="bg-primary/12 text-primary px-1.5 font-semibold"
                >
                  {activeCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>

          <PopoverContent
            align="end"
            className="w-[19rem] bg-background border-border"
          >
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-sm font-medium">Search specific fields</p>
                <p className="text-xs text-muted-foreground">
                  Fields combine — a household must match all of them.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="hh-first-name"
                    className="text-xs text-muted-foreground"
                  >
                    First name
                  </Label>
                  <Input
                    id="hh-first-name"
                    value={filters.firstName}
                    onChange={(e) => onChange({ firstName: e.target.value })}
                    placeholder="Jane"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="hh-last-name"
                    className="text-xs text-muted-foreground"
                  >
                    Last name
                  </Label>
                  <Input
                    id="hh-last-name"
                    value={filters.lastName}
                    onChange={(e) => onChange({ lastName: e.target.value })}
                    placeholder="Doe"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="hh-dob"
                  className="text-xs text-muted-foreground"
                >
                  Date of birth
                </Label>
                <Input
                  id="hh-dob"
                  type="date"
                  value={filters.dateOfBirth}
                  onChange={(e) => onChange({ dateOfBirth: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="hh-ref"
                  className="text-xs text-muted-foreground"
                >
                  Household number
                </Label>
                <Input
                  id="hh-ref"
                  value={filters.householdRef}
                  onChange={(e) => onChange({ householdRef: e.target.value })}
                  placeholder="HH-2614"
                />
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="hh-policy"
                  className="text-xs text-muted-foreground"
                >
                  Policy number
                </Label>
                <Input
                  id="hh-policy"
                  value={filters.policyNumber}
                  onChange={(e) => onChange({ policyNumber: e.target.value })}
                  placeholder="AS-1234567"
                />
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={onClear}
                disabled={activeCount === 0}
                className="self-start"
              >
                Clear fields
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
