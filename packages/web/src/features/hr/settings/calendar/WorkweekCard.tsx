import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AgencyCalendarView, Weekday } from "@sfa/shared";
import { DetailCard } from "@/components/common/DetailCard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getHolidayRegions,
  hrKeys,
  updateAgencyCalendar,
} from "@/lib/hr-api";
import { cn } from "@/lib/utils";
import { hrErrorMessage } from "../hr-error";
import { WEEKDAY_ORDER, WEEKDAY_SHORT } from "./calendar-display";

const NONE = "__none__";

interface WorkweekCardProps {
  calendar: AgencyCalendarView;
  canWrite: boolean;
  /** "Save" in settings, "Save calendar" in the wizard. */
  saveLabel?: string;
  onSaved?: (next: AgencyCalendarView) => void;
}

/**
 * The workweek and where the agency is (PAC-161). Seven toggles rather than
 * seven checkboxes: the question is "which days is the office open", and a
 * row of day chips reads as the week it describes. Country and region feed
 * the holiday suggestions and the Q4 proposal job; nothing else.
 */
export function WorkweekCard({
  calendar,
  canWrite,
  saveLabel = "Save",
  onSaved,
}: WorkweekCardProps) {
  const queryClient = useQueryClient();
  const [workweek, setWorkweek] = useState<Weekday[]>(calendar.workweek);
  const [country, setCountry] = useState<string | null>(calendar.country);
  const [region, setRegion] = useState<string | null>(calendar.region);

  useEffect(() => {
    setWorkweek(calendar.workweek);
    setCountry(calendar.country);
    setRegion(calendar.region);
  }, [calendar.workweek, calendar.country, calendar.region]);

  const regionsQuery = useQuery({
    queryKey: hrKeys.regions(country),
    queryFn: () => getHolidayRegions(country),
    enabled: canWrite,
  });

  const save = useMutation({
    mutationFn: () => updateAgencyCalendar({ workweek, country, region }),
    onSuccess: (next) => {
      queryClient.setQueryData(hrKeys.calendar(next.year), next);
      toast.success("Calendar settings saved.");
      onSaved?.(next);
    },
    onError: (error) => toast.error(hrErrorMessage(error)),
  });

  const dirty =
    [...workweek].sort().join() !== [...calendar.workweek].sort().join() ||
    country !== calendar.country ||
    region !== calendar.region;

  return (
    <DetailCard title="Working week">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Open on</Label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_ORDER.map((day) => {
              const on = workweek.includes(day);
              return (
                <Button
                  key={day}
                  type="button"
                  size="sm"
                  variant={on ? "default" : "outline"}
                  aria-pressed={on}
                  disabled={!canWrite}
                  className={cn("min-w-14", !on && "text-muted-foreground")}
                  onClick={() =>
                    setWorkweek((current) =>
                      on
                        ? current.filter((d) => d !== day)
                        : [...current, day].sort((a, b) => a - b),
                    )
                  }
                >
                  {WEEKDAY_SHORT[day]}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="hr-country">Country</Label>
            <Select
              value={country ?? NONE}
              disabled={!canWrite}
              onValueChange={(value) => {
                const next = value === NONE ? null : value;
                setCountry(next);
                setRegion(null);
              }}
            >
              <SelectTrigger id="hr-country" className="w-full bg-card border-border">
                <SelectValue placeholder="Choose a country" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={NONE}>Not set</SelectItem>
                {(regionsQuery.data?.countries ?? (country ? [{ code: country, name: country }] : [])).map(
                  (option) => (
                    <SelectItem key={option.code} value={option.code}>
                      {option.name}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="hr-region">State or province</Label>
            <Select
              value={region ?? NONE}
              disabled={!canWrite || !country}
              onValueChange={(value) => setRegion(value === NONE ? null : value)}
            >
              <SelectTrigger id="hr-region" className="w-full bg-card border-border">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={NONE}>None</SelectItem>
                {(regionsQuery.data?.regions ?? (region ? [{ code: region, name: region }] : [])).map(
                  (option) => (
                    <SelectItem key={option.code} value={option.code}>
                      {option.name}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        {canWrite && (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="brand"
              disabled={!dirty || workweek.length === 0 || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : saveLabel}
            </Button>
          </div>
        )}
      </div>
    </DetailCard>
  );
}
