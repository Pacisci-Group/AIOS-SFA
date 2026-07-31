import { LEAD_STATUSES, LEAD_TEMPERATURE_OPTIONS } from "@sfa/shared";
import { Search, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ANY_OPTION,
  countActiveFilters,
  toFilterValue,
  toSelectValue,
  type LeadFilters,
} from "./lead-filters";

interface LeadsFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  filters: LeadFilters;
  onChange: (patch: Partial<LeadFilters>) => void;
  onOpenAdvanced: () => void;
  /** Rendered only for branch/agency users — a producer has nothing to toggle. */
  showScopeToggle: boolean;
  scope: "own" | "agency";
  onScopeChange: (scope: "own" | "agency") => void;
}

/** Search + the always-visible quick filters + the advanced-filters trigger. */
export function LeadsFilters({
  search,
  onSearchChange,
  filters,
  onChange,
  onOpenAdvanced,
  showScopeToggle,
  scope,
  onScopeChange,
}: LeadsFiltersProps) {
  const activeCount = countActiveFilters(filters);

  return (
    <div className="flex flex-col gap-3 mb-5">
      {showScopeToggle && (
        <div className="flex items-center gap-1 w-fit rounded-lg p-1 bg-card border border-border">
          {(["own", "agency"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onScopeChange(value)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs transition-colors",
                scope === value
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value === "own" ? "My Leads" : "Agency Leads"}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1 min-w-0">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name, phone, email, or lead source…"
            className="pl-9 bg-card border-border"
          />
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={toSelectValue(filters.status)}
            onValueChange={(v) => onChange({ status: toFilterValue(v) })}
          >
            <SelectTrigger className="flex-1 md:w-[150px] md:flex-none bg-card border-border">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_OPTION}>All statuses</SelectItem>
              {LEAD_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={toSelectValue(filters.temperature)}
            onValueChange={(v) => onChange({ temperature: toFilterValue(v) })}
          >
            <SelectTrigger className="flex-1 md:w-[150px] md:flex-none bg-card border-border">
              <SelectValue placeholder="All temperatures" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_OPTION}>All temperatures</SelectItem>
              {LEAD_TEMPERATURE_OPTIONS.map((temperature) => (
                <SelectItem key={temperature} value={temperature}>
                  {temperature}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            onClick={onOpenAdvanced}
            className="shrink-0 bg-card border-border"
          >
            <SlidersHorizontal size={14} />
            <span className="hidden sm:inline">Filters</span>
            {activeCount > 0 && (
              <Badge className="bg-primary/12 text-primary border-transparent rounded-full text-[10px] px-1.5 py-0 font-semibold">
                {activeCount}
              </Badge>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
