import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";
import { toast } from "sonner";
import type { HolidayProposalView } from "@sfa/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  confirmHolidayProposal,
  dismissHolidayProposal,
  hrKeys,
} from "@/lib/hr-api";
import { hrErrorMessage } from "../hr-error";
import { formatIsoDate } from "./calendar-display";

interface ProposalBannerProps {
  proposal: HolidayProposalView;
  /** Opens the review dialog on mount — the notification's deep link. */
  openReview?: boolean;
}

/**
 * Next year's holidays, as the Q4 job proposed them (PAC-161): confirm them
 * all in one click, review which to keep, or dismiss. Nothing lands on the
 * calendar until one of the first two.
 */
export function ProposalBanner({ proposal, openReview = false }: ProposalBannerProps) {
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState(openReview);
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(proposal.items.map((item) => item.date)),
  );
  useEffect(() => {
    setTicked(new Set(proposal.items.map((item) => item.date)));
  }, [proposal]);

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
          <span>Confirm them now, or review which to keep.</span>
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
              disabled={busy}
              onClick={() => confirm.mutate(proposal.items.map((item) => item.date))}
            >
              Confirm all
            </Button>
          </span>
        </AlertDescription>
      </Alert>

      <Dialog open={reviewing} onOpenChange={(open) => !open && setReviewing(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Holidays for {proposal.year}</DialogTitle>
            <DialogDescription>Untick any the office stays open for.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto pr-1">
            {proposal.items.map((item) => {
              const id = `hr-proposal-${item.date}`;
              return (
                <li key={item.date} className="flex items-start gap-3 py-1.5">
                  <Checkbox
                    id={id}
                    checked={ticked.has(item.date)}
                    className="mt-0.5"
                    onCheckedChange={(checked) =>
                      setTicked((current) => {
                        const next = new Set(current);
                        if (checked === true) next.add(item.date);
                        else next.delete(item.date);
                        return next;
                      })
                    }
                  />
                  <Label htmlFor={id} className="grid gap-0.5 font-normal">
                    <span className="text-sm text-foreground">
                      {item.name}
                      {item.substitute && (
                        <span className="ml-1 text-xs text-muted-foreground">(observed)</span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatIsoDate(item.date)}</span>
                  </Label>
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setReviewing(false)}>
              Cancel
            </Button>
            <Button type="button" variant="brand" disabled={busy} onClick={() => confirm.mutate([...ticked])}>
              {confirm.isPending ? "Confirming…" : `Confirm ${ticked.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
