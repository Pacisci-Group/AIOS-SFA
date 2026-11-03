import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";
import { toast } from "sonner";
import type { HolidayProposalView, Weekday } from "@sfa/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  confirmHolidayProposal,
  dismissHolidayProposal,
} from "@/lib/hr-api";
import { hrErrorMessage } from "../hr-error";
import {
  defaultHolidayPickerValue,
  HolidayPicker,
  type HolidayPickerValue,
} from "./HolidayPicker";

interface ProposalBannerProps {
  proposal: HolidayProposalView;
  workweek: readonly Weekday[];
  /** Opens the review dialog on mount — the notification's deep link. */
  openReview?: boolean;
}

/**
 * Next year's holidays, as the Q4 job proposed them (PAC-161): confirm the
 * pre-checked ones in one click ("Confirm N" — the federal set, never every
 * observance), review which to keep in the shared `HolidayPicker`, or
 * dismiss. Nothing lands on the calendar until one of the first two. A
 * custom holiday is not part of a proposal; those go through the year grid.
 */
export function ProposalBanner({
  proposal,
  workweek,
  openReview = false,
}: ProposalBannerProps) {
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState(openReview);
  const [value, setValue] = useState<HolidayPickerValue>(() =>
    defaultHolidayPickerValue(proposal.items),
  );
  useEffect(() => {
    setValue(defaultHolidayPickerValue(proposal.items));
  }, [proposal]);
  const preChecked = proposal.items.filter((item) => item.preChecked).length;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["hr", "calendar"] });
  };

  const confirm = useMutation({
    mutationFn: (dates: string[]) => confirmHolidayProposal(proposal.year, { dates }),
    onSuccess: (_result, dates) => {
      refresh();
      setReviewing(false);
      toast.success(
        `${dates.length} holiday${dates.length === 1 ? "" : "s"} added for ${proposal.year}.`,
      );
    },
    onError: (error) => toast.error(hrErrorMessage(error)),
  });

  const dismiss = useMutation({
    mutationFn: () => dismissHolidayProposal(proposal.year),
    onSuccess: () => {
      refresh();
      toast.success(`Proposal for ${proposal.year} dismissed.`);
    },
    onError: (error) => toast.error(hrErrorMessage(error)),
  });

  const busy = confirm.isPending || dismiss.isPending;

  return (
    <>
      <Alert className="border-primary/40 bg-primary/5">
        <CalendarCheck className="size-4" />
        <AlertTitle>
          {proposal.items.length} holiday{proposal.items.length === 1 ? "" : "s"} suggested for{" "}
          {proposal.year}
        </AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-2">
          <span>
            Confirm the {preChecked} federal holiday{preChecked === 1 ? "" : "s"} now, or
            review which to keep.
          </span>
          <span className="ml-auto flex gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => dismiss.mutate()}>
              Dismiss
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setReviewing(true)}>
              Review…
            </Button>
            <Button
              type="button"
              size="sm"
              variant="brand"
              disabled={busy || preChecked === 0}
              onClick={() =>
                confirm.mutate(
                  proposal.items.filter((item) => item.preChecked).map((item) => item.date),
                )
              }
            >
              Confirm {preChecked}
            </Button>
          </span>
        </AlertDescription>
      </Alert>

      <Dialog open={reviewing} onOpenChange={(open) => !open && setReviewing(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Holidays for {proposal.year}</DialogTitle>
            <DialogDescription>
              Federal holidays are ticked. Untick any the office stays open for, and tick any others it closes for.
            </DialogDescription>
          </DialogHeader>
          <HolidayPicker
            items={proposal.items}
            workweek={workweek}
            year={proposal.year}
            value={value}
            onChange={setValue}
            allowCustom={false}
            disabled={busy}
            className="max-h-[55vh] overflow-y-auto pr-1"
          />
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setReviewing(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="brand"
              disabled={busy}
              onClick={() => confirm.mutate([...value.ticked])}
            >
              {confirm.isPending ? "Confirming…" : `Confirm ${value.ticked.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
