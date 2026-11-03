import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Weekday } from "@sfa/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { addCalendarDays, getHolidaySuggestions } from "@/lib/hr-api";
import { hrErrorMessage } from "../hr-error";
import {
  defaultHolidayPickerValue,
  HolidayPicker,
  holidayPickerDays,
  type HolidayPickerValue,
} from "./HolidayPicker";

interface HolidayImportDialogProps {
  open: boolean;
  onClose: () => void;
  country: string | null;
  region: string | null;
  year: number;
  workweek: readonly Weekday[];
}

/**
 * "Import holidays for YEAR" (PAC-161): what `date-holidays` suggests for the
 * agency's country and region in the shared `HolidayPicker` — federal ticked,
 * other unticked, custom ranges — written as `import` rows. Nothing is
 * written until Import: the whole point of suggestions is that a person
 * decides.
 */
export function HolidayImportDialog({
  open,
  onClose,
  country,
  region,
  year,
  workweek,
}: HolidayImportDialogProps) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["hr", "suggestions", country, region, year] as const,
    queryFn: () => getHolidaySuggestions({ country: country!, region, year }),
    enabled: open && country !== null,
  });

  const [value, setValue] = useState<HolidayPickerValue>({ ticked: [], custom: [] });
  useEffect(() => {
    if (query.data) setValue(defaultHolidayPickerValue(query.data.suggestions));
  }, [query.data]);

  const days = query.data
    ? holidayPickerDays(value, query.data.suggestions, workweek)
    : [];

  const importDays = useMutation({
    mutationFn: () => addCalendarDays({ source: "import", days }),
    onSuccess: (result) => {
      // Every year: a custom range may run into the next one.
      void queryClient.invalidateQueries({ queryKey: ["hr", "calendar"] });
      toast.success(
        `${result.days.length} holiday${result.days.length === 1 ? "" : "s"} added for ${year}.`,
      );
      onClose();
    },
    onError: (error) => toast.error(hrErrorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import holidays for {year}</DialogTitle>
          <DialogDescription>
            {country
              ? "Federal holidays are ticked. Untick any the office stays open for, tick any others it closes for, and add your own."
              : "Choose a country in Working week first."}
          </DialogDescription>
        </DialogHeader>

        {country && query.isPending ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : query.isError ? (
          <p className="text-sm text-destructive">{hrErrorMessage(query.error)}</p>
        ) : query.data ? (
          <HolidayPicker
            items={query.data.suggestions}
            workweek={workweek}
            year={year}
            value={value}
            onChange={setValue}
            disabled={importDays.isPending}
            className="max-h-[55vh] overflow-y-auto pr-1"
          />
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={importDays.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="brand"
            disabled={!query.data || days.length === 0 || importDays.isPending}
            onClick={() => importDays.mutate()}
          >
            {importDays.isPending ? "Importing…" : `Import ${days.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
