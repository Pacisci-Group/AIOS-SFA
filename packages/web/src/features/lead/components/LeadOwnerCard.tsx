import type { LeadDetail } from "@sfa/shared";
import { AlertTriangle, Loader2, UserCheck } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/hooks/usePermissions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { reassignLead } from "@/lib/leads-api";
import { listUsers } from "@/lib/users-api";
import { DetailCard } from "./DetailCard";
import { leadDetailKey } from "./useUpdateLead";

/**
 * Who owns this lead, and — for those who may — a control to hand it over
 * (PAC-72 section D).
 *
 * ## Who sees the picker
 *
 * `PATCH /leads/:id/assignment` requires `leads:write` **and**
 * `agency:users:read`. Only the Agency Owner and Branch Manager templates hold
 * the second, so a producer sees the owner as text — they cannot hand off even
 * their own leads. That is the decision taken on 2026-08-21, and it is also why
 * the picker's roster (`GET /users`) is reachable by exactly the people who can
 * act on it, with no new endpoint needed.
 *
 * ## Why a sold lead is frozen
 *
 * Once a lead is sold, `Deal.producerId` is what the scorecards and the
 * leaderboard read. Letting the lead move afterwards would make the two
 * disagree about the same sale, so the API refuses with a `409` and the control
 * disables itself rather than offering an action that would bounce.
 */
export function LeadOwnerCard({ lead }: { lead: LeadDetail }) {
  const queryClient = useQueryClient();
  const { can, canWrite } = usePermissions();
  const canReassign = canWrite("leads") && can("agency:users:read");

  // A sold lead's owner is fixed — see the docblock.
  const frozen = lead.status === "Sold";

  const users = useQuery({
    queryKey: ["agency-users"],
    queryFn: listUsers,
    enabled: canReassign && !frozen,
  });

  const reassign = useMutation({
    mutationFn: (producerId: string) => reassignLead(lead.id, producerId),
    onSuccess: () => {
      // The detail read carries the owner, and the timeline gains a
      // `lead_reassigned` row — both come from the same query.
      void queryClient.invalidateQueries({ queryKey: leadDetailKey(lead.id) });
      // The list and the dashboard panel are both scoped by owner, so a lead
      // that just moved may have left the caller's view entirely.
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["hot-leads"] });
    },
  });

  const owner = lead.producerName ?? "Unassigned";

  return (
    <DetailCard title="Owner" icon={UserCheck}>
      {canReassign && !frozen ? (
        <div className="flex flex-col gap-2">
          <Select
            value={lead.producerId ?? undefined}
            onValueChange={(producerId) => reassign.mutate(producerId)}
            disabled={reassign.isPending || users.isPending}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={owner} />
            </SelectTrigger>
            <SelectContent>
              {(users.data ?? [])
                // Assigning to a de-provisioned account is how a lead quietly
                // reaches nobody; the API refuses it too.
                .filter((user) => user.isActive)
                .map((user) => (
                  <SelectItem key={user._id} value={user._id}>
                    {[user.firstName, user.lastName]
                      .filter(Boolean)
                      .join(" ")
                      .trim() || user.email}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>

          {reassign.isPending && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Reassigning…
            </p>
          )}

          {reassign.isError && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              {(reassign.error as Error).message ||
                "Couldn't reassign this lead."}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-card-foreground">{owner}</p>
          {frozen && (
            // Said plainly rather than shown as a disabled control with no
            // explanation — the freeze is a rule, not a permission problem.
            <p className="text-xs text-muted-foreground">
              Sold leads keep their producer — the sale records who earned it.
            </p>
          )}
        </div>
      )}
    </DetailCard>
  );
}
