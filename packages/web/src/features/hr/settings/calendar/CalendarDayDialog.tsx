import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CALENDAR_DAY_KINDS,
  type AgencyCalendarDayView,
  type AgencyCalendarView,
  type CalendarDayKind,
} from "@sfa/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { addCalendarDays, hrKeys, removeCalendarDay } from "@/lib/hr-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { hrErrorMessage } from "../hr-error";
import {
  DAY_KIND_LABELS,
  SOURCE_LABELS,
  formatIsoDate,
} from "./calendar-display";

interface CalendarDayDialogProps {
  year: number;
  /** The day clicked, or `null` when closed. */
  date: string | null;
  existing: AgencyCalendarDayView | null;
  onClose: () => void;
}

/**
 * Add a day by hand, or remove one — both with a reason (PAC-161). A manual
 * change is the one kind of row the API will not take without one: it is the
 * audit trail for "why was the office closed that Tuesday".
 */
export function CalendarDayDialog({
  year,
  date,
  existing,
  onClose,
}: CalendarDayDialogProps) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<CalendarDayKind>("closure");
  const [label, setLabel] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (date) {
      setKind("closure");
      setLabel("");
      setReason("");
    }
  }, [date]);

  const patchCalendar = (
    update: (current: AgencyCalendarView) => AgencyCalendarView,
  ) =>
    queryClient.setQueryData<AgencyCalendarView>(hrKeys.calendar(year), (current) =>
      current ? update(current) : current,
    );

  const add = useMutation({
    mutationFn: () =>
      addCalendarDays({
        source: "manual",
        days: [{ date: date!, kind, label: label.trim(), reason: reason.trim() }],
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hrKeys.calendar(year) });
      toast.success("Day added.");
      onClose();
    },
    onError: (error) => toast.error(hrErrorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => removeCalendarDay(existing!.id, reason.trim()),
    onSuccess: (removed) => {
      patchCalendar((current) => ({
        ...current,
        days: current.days.filter((day) => day.id !== removed.id),
      }));
      void queryClient.invalidateQueries({ queryKey: hrKeys.calendar(year) });
      toast.success("Day removed.");
      onClose();
    },
    onError: (error) => toast.error(hrErrorMessage(error)),
  });

  const busy = add.isPending || remove.isPending;

  return (
    <Dialog open={date !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {date && existing ? (
          <>
            <DialogHeader>
              <DialogTitle>{existing.label}</DialogTitle>
              <DialogDescription>
                {DAY_KIND_LABELS[existing.kind]} on {formatIsoDate(existing.date)}
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Added</dt>
              <dd>
                {SOURCE_LABELS[existing.source]}
                {existing.createdBy ? ` by ${existing.createdBy.name}` : ""}
              </dd>
              <dt className="text-muted-foreground">Reason</dt>
              <dd>{existing.reason ?? NOT_AVAILABLE}</dd>
            </dl>
            <div className="space-y-2">
              <Label htmlFor="hr-remove-reason">Why remove it?</Label>
              <Textarea
                id="hr-remove-reason"
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Kept in the history with the day."
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy || reason.trim().length === 0}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? "Removing…" : "Remove day"}
              </Button>
            </DialogFooter>
          </>
        ) : date ? (
          <>
            <DialogHeader>
              <DialogTitle>Add {formatIsoDate(date)}</DialogTitle>
              <DialogDescription>
                A closure or holiday closes the office; a special working day opens it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="hr-day-kind">Kind</Label>
                <Select value={kind} onValueChange={(value) => setKind(value as CalendarDayKind)}>
                  <SelectTrigger id="hr-day-kind" className="w-full bg-card border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CALENDAR_DAY_KINDS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {DAY_KIND_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="hr-day-label">Label</Label>
                <Input
                  id="hr-day-label"
                  value={label}
                  maxLength={120}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder={kind === "closure" ? "Office closed" : "Inventory day"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hr-day-reason">Reason</Label>
                <Textarea
                  id="hr-day-reason"
                  rows={2}
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Required for a change made by hand."
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="brand"
                disabled={busy || label.trim().length === 0 || reason.trim().length === 0}
                onClick={() => add.mutate()}
              >
                {add.isPending ? "Adding…" : "Add day"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
