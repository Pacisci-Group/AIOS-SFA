import { LEAD_SOURCE_LABELS, LEAD_STATUSES } from "@sfa/shared";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { usePermissions } from "@/hooks/usePermissions";
import { listUsers } from "@/lib/users-api";
import {
  ANY_OPTION,
  EMPTY_LEAD_FILTERS,
  toFilterValue,
  toSelectValue,
  type LeadFilters,
} from "./lead-filters";

interface LeadsFilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: LeadFilters;
  onChange: (patch: Partial<LeadFilters>) => void;
  onClear: () => void;
  /** Producers can only ever see their own leads, so the filter is pointless. */
  showProducerFilter: boolean;
}

/**
 * Advanced filters — status, date range, lead source, producer.
 *
 * Serves as both the desktop drawer and the mobile filter panel (a `Sheet` is
 * the same component either way). Every control applies **on change**: there is
 * no Apply button, per the project's real-time faceted filtering rule. The
 * footer only offers Clear and Done.
 */
export function LeadsFilterSheet({
  open,
  onOpenChange,
  filters,
  onChange,
  onClear,
  showProducerFilter,
}: LeadsFilterSheetProps) {
  const { can } = usePermissions();
  const canListUsers = can("agency:users:read");

  const producersQuery = useQuery({
    queryKey: ["users"],
    queryFn: listUsers,
    // Only owners/managers may read the agency directory; asking without the
    // permission would just 403.
    enabled: open && showProducerFilter && canListUsers,
  });

  const producers = (producersQuery.data ?? []).filter((u) => !u.isPlatformAdmin);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="bg-background border-border">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>
            Filters apply as you change them.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 overflow-y-auto">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select
              value={toSelectValue(filters.status)}
              onValueChange={(v) => onChange({ status: toFilterValue(v) })}
            >
              <SelectTrigger className="w-full bg-card border-border">
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
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Lead source</Label>
            <Select
              value={toSelectValue(filters.leadSource)}
              onValueChange={(v) => onChange({ leadSource: toFilterValue(v) })}
            >
              <SelectTrigger className="w-full bg-card border-border">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_OPTION}>All sources</SelectItem>
                {LEAD_SOURCE_LABELS.filter((label) => label !== "Test").map(
                  (label) => (
                    <SelectItem key={label} value={label}>
                      {label}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Created from</Label>
              <Input
                type="date"
                value={filters.dateFrom}
                max={filters.dateTo || undefined}
                onChange={(e) => onChange({ dateFrom: e.target.value })}
                className="bg-card border-border"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Created to</Label>
              <Input
                type="date"
                value={filters.dateTo}
                min={filters.dateFrom || undefined}
                onChange={(e) => onChange({ dateTo: e.target.value })}
                className="bg-card border-border"
              />
            </div>
          </div>

          {showProducerFilter && canListUsers && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Producer</Label>
              <Select
                value={toSelectValue(filters.producerId)}
                onValueChange={(v) => onChange({ producerId: toFilterValue(v) })}
              >
                <SelectTrigger className="w-full bg-card border-border">
                  <SelectValue placeholder="All producers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_OPTION}>All producers</SelectItem>
                  {producers.map((user) => (
                    <SelectItem key={user._id} value={user._id}>
                      {[user.firstName, user.lastName]
                        .filter(Boolean)
                        .join(" ")
                        .trim() || user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <SheetFooter>
          <Button
            variant="outline"
            onClick={onClear}
            disabled={
              JSON.stringify(filters) === JSON.stringify(EMPTY_LEAD_FILTERS)
            }
          >
            Clear all
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
