import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api-client";
import {
  agencyUserOptionsKey,
  deactivateUser,
  isWorkTransfer,
  listTransferCandidates,
  previewWorkRelease,
  previewWorkTransfer,
  transferWork,
  type AgencyUser,
  type ReleasedWork,
  type WorkTransferCounts,
} from "@/lib/users-api";

/** Radix `Select` refuses an empty-string value, so "nobody" needs a token. */
const RELEASE = "__release__";

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One line per non-zero kind of work, in the order an owner thinks of it. */
function transferLines(counts: WorkTransferCounts): string[] {
  const lines = [
    counts.tickets && plural(counts.tickets, "open ticket"),
    counts.onboardings &&
      `${plural(counts.onboardings, "onboarding")} in progress — their next calls go to the new person`,
    counts.renewalCycles &&
      `${plural(counts.renewalCycles, "renewal")} in progress`,
    counts.households && plural(counts.households, "client household"),
    counts.leads && plural(counts.leads, "open lead"),
    counts.audits && plural(counts.audits, "open deal audit"),
    counts.auditItems &&
      `${plural(counts.auditItems, "open audit item")} — the new person resolves them`,
    counts.shareLinks &&
      `${plural(counts.shareLinks, "share link")} — new leads from them go to the new person`,
    counts.rotationsTakenOver &&
      plural(counts.rotationsTakenOver, "round-robin slot"),
    counts.rotationsDeactivated &&
      `${plural(counts.rotationsDeactivated, "duplicate round-robin slot")} switched off`,
  ];
  return lines.filter((line): line is string => Boolean(line));
}

function releaseLines(released: ReleasedWork): string[] {
  const lines = [
    released.ticketsUnassigned &&
      `${plural(released.ticketsUnassigned, "open ticket")} back to the unassigned queue`,
    released.onboardingsUnassigned &&
      `${plural(released.onboardingsUnassigned, "onboarding")} in progress — their next calls open unassigned`,
    released.renewalCyclesUnassigned &&
      `${plural(released.renewalCyclesUnassigned, "renewal")} in progress — their calls open unassigned`,
    released.householdsUnassigned &&
      `${plural(released.householdsUnassigned, "client household")} without a CSR — the next sale picks one by round-robin`,
    released.leadsUnassigned &&
      `${plural(released.leadsUnassigned, "open lead")} back to the unclaimed pool`,
    released.rotationsDeactivated &&
      `${plural(released.rotationsDeactivated, "round-robin slot")} switched off`,
  ];
  return lines.filter((line): line is string => Boolean(line));
}

function nameOf(user: {
  firstName?: string;
  lastName?: string;
  email: string;
}): string {
  return (
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.email
  );
}

interface TransferWorkDialogProps {
  user: AgencyUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * `transfer` hands the work over and nothing else — a successor is required.
   * `remove` deactivates the person too, and the successor is optional:
   * leaving it empty releases the work to the queue, as removal always has.
   */
  mode: "transfer" | "remove";
  /** Whether the caller holds `agency:work_transfer:write`. Remove mode only. */
  canTransfer: boolean;
}

/**
 * Hand a person's open work to a colleague, alone or as part of removing them
 * (PAC-136 / PAC-137).
 *
 * The counts come from the server's preview, which runs the same plan and the
 * same validation as the real thing — so a refused successor (deactivated, in
 * another branch) shows up here as an error before anyone clicks confirm, and
 * the numbers are what will actually move rather than a client-side guess.
 */
export function TransferWorkDialog({
  user,
  open,
  onOpenChange,
  mode,
  canTransfer,
}: TransferWorkDialogProps) {
  const queryClient = useQueryClient();
  const [successor, setSuccessor] = useState<string>(RELEASE);
  const removing = mode === "remove";
  const pickSuccessor = !removing || canTransfer;
  const toUserId = successor === RELEASE ? null : successor;

  // Each opening starts clean, so a choice from last time is never confirmed
  // by accident against a different person.
  useEffect(() => {
    if (open) setSuccessor(RELEASE);
  }, [open]);

  // Same-role colleagues only, decided by the server — the transfer refuses
  // anyone else, so offering them here would only teach the error.
  const options = useQuery({
    queryKey: ["users", user._id, "work-transfer-candidates"],
    queryFn: () => listTransferCandidates(user._id),
    enabled: open && pickSuccessor,
  });
  const colleagues = options.data ?? [];

  const transferPreview = useQuery({
    queryKey: ["users", user._id, "work-transfer", toUserId],
    queryFn: () => previewWorkTransfer(user._id, toUserId!),
    enabled: open && toUserId !== null,
    retry: false,
  });
  const releasePreview = useQuery({
    queryKey: ["users", user._id, "work-release"],
    queryFn: () => previewWorkRelease(user._id),
    enabled: open && removing && toUserId === null,
  });

  const invalidate = () => {
    for (const queryKey of [
      ["users"],
      agencyUserOptionsKey,
      ["leads"],
      ["hot-leads"],
      ["households"],
      ["service-tickets"],
      ["deal-audits"],
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };

  const confirm = useMutation({
    mutationFn: () =>
      removing
        ? deactivateUser(user._id, toUserId ?? undefined)
        : transferWork(user._id, toUserId!),
    onSuccess: (result) => {
      invalidate();
      const moved = isWorkTransfer(result)
        ? transferLines(result)
        : releaseLines(result);
      const what = moved.length ? moved.join(", ") : "Nothing was open";
      if (isWorkTransfer(result)) {
        toast.success(removing ? "User removed" : "Work transferred", {
          description: `${what} — now with ${result.toName}.`,
        });
      } else {
        toast.success("User removed", {
          description: `They can no longer sign in. ${what}.`,
        });
      }
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError
          ? error.message
          : removing
            ? "Could not remove this user."
            : "Could not transfer the work.",
      ),
  });

  const preview = toUserId ? transferPreview : releasePreview;
  const lines = toUserId
    ? transferPreview.data && transferLines(transferPreview.data)
    : releasePreview.data && releaseLines(releasePreview.data);
  // A refused successor blocks confirm, and so does a preview still in flight
  // — a 409 must land before the click, not after. A failed *release* count
  // does not block: removal never depended on it, and the server re-checks
  // everything anyway.
  const ready = toUserId
    ? !transferPreview.isError && !transferPreview.isFetching
    : removing;
  const who = nameOf(user);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {removing ? `Remove ${who}?` : `Transfer ${who}’s work`}
          </DialogTitle>
          <DialogDescription>
            {removing
              ? "They are signed out immediately and can no longer access the agency. You can reactivate them later."
              : "Their open work goes to the colleague you choose."}{" "}
            Completed work stays on record under their name.
          </DialogDescription>
        </DialogHeader>

        {pickSuccessor && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="transfer-successor">
              {removing ? "Hand open work to" : "Transfer to"}
            </Label>
            <Select value={successor} onValueChange={setSuccessor}>
              <SelectTrigger
                id="transfer-successor"
                className="w-full"
                disabled={options.isPending}
              >
                <SelectValue placeholder="Choose a colleague" />
              </SelectTrigger>
              <SelectContent>
                {removing ? (
                  <SelectItem value={RELEASE}>
                    Nobody — release it to the queue
                  </SelectItem>
                ) : (
                  <SelectItem value={RELEASE} disabled>
                    Choose a colleague
                  </SelectItem>
                )}
                {colleagues.map((colleague) => (
                  <SelectItem key={colleague._id} value={colleague._id}>
                    {nameOf(colleague)}
                  </SelectItem>
                ))}
                {options.isSuccess && colleagues.length === 0 && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    No active colleague holds the same role
                  </p>
                )}
              </SelectContent>
            </Select>
          </div>
        )}

        {(removing || toUserId) && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            {preview.isFetching ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Counting open work…
              </p>
            ) : preview.isError ? (
              <p className="text-destructive">
                {preview.error instanceof ApiError
                  ? preview.error.message
                  : "Could not check this person’s open work."}
              </p>
            ) : lines && lines.length > 0 ? (
              <>
                <p className="mb-1.5 font-medium">
                  {toUserId ? "What moves" : "What happens to their work"}
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground">
                Nothing open to hand over.
              </p>
            )}
            {/* Release has nowhere to put these — an unassigned audit falls
                back to its seller, who is the person leaving — so say so
                while there is still a picker to fix it with. */}
            {removing && !toUserId && !preview.isFetching && (
              <p className="mt-2 text-xs text-muted-foreground">
                Open deal audits stay assigned to them and their share links
                stop working.
                {pickSuccessor
                  ? " Choose a colleague above to hand those over too."
                  : ""}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={confirm.isPending}
          >
            Cancel
          </Button>
          <Button
            variant={removing ? "destructive" : "default"}
            onClick={() => confirm.mutate()}
            disabled={confirm.isPending || !ready}
          >
            {confirm.isPending && <Loader2 className="size-4 animate-spin" />}
            {removing ? "Remove user" : "Transfer work"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
