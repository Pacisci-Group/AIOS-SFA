import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { reassignLead } from "@/lib/leads-api";
import {
  listUserOptionsWhere,
  userOptionsKey,
  type UserOptionsParams,
} from "@/lib/users-api";

/**
 * Who this picker lists: producers who are taking leads (PAC-144).
 *
 * Filtered by the server, not here — it used to be every active employee
 * narrowed in the browser to `available` + `busy`, so CSRs, managers and the
 * owner were all offered as producers. Availability is an allow-list, not
 * "everyone except X": a status added to `USER_AVAILABILITIES` later stays out
 * of the picker until someone decides it belongs here. `busy` is out on
 * purpose — a busy producer is not taking new leads.
 *
 * `producer` is the role **slug**, the same one the Team Activity roster keys
 * on, so renaming the role in an agency does not empty the picker.
 */
const ASSIGNABLE_PRODUCERS: UserOptionsParams = {
  role: "producer",
  availability: ["available"],
};

interface AssignProducerMenuProps {
  leadId: string;
  /** The pool's name for this lead, for the error message. */
  leadName: string;
}

/**
 * Hand one pooled lead to a producer (PAC-138).
 *
 * ## Why this reuses `PATCH /leads/:id/assignment` unchanged
 *
 * There is no "claim" endpoint, deliberately. Assignment already enforces the
 * rules this action needs — the sold-lead freeze, the same-agency and active-user
 * checks, and the `lead_reassigned` timeline entry — and
 * `LeadAssignmentService` is exported precisely so a second caller does not
 * re-implement them. An unclaimed lead has no previous owner, so the entry it
 * writes reads "Lead assigned to X" rather than "reassigned from", with no new
 * activity type needed.
 *
 * ## Who sees this
 *
 * Nobody renders this without `leads:write` **and** `agency:users:read` — see
 * `UnclaimedPoolPanel`, which gates it once for the whole table rather than
 * per row. Those two together are the Agency Owner and Branch Manager, which is
 * the 2026-08-21 decision that a producer cannot reassign a lead, not even their
 * own. A producer taking a lead *from the pool* is a request an approver acts
 * on, and that flow is not built yet (PAC-59 → PAC-105).
 *
 * ## Losing a race is a message, not a silent overwrite
 *
 * Two managers can be looking at the same pool row. The API compares and swaps
 * on the owner it read and returns `409` to the loser, so the error below is a
 * real case here rather than a defensive branch — it names who won.
 */
export function AssignProducerMenu({
  leadId,
  leadName,
}: AssignProducerMenuProps) {
  const queryClient = useQueryClient();

  const users = useQuery({
    queryKey: userOptionsKey(ASSIGNABLE_PRODUCERS),
    queryFn: () => listUserOptionsWhere(ASSIGNABLE_PRODUCERS),
  });
  const producers = users.data ?? [];

  const assign = useMutation({
    mutationFn: (producerId: string) => reassignLead(leadId, producerId),
    onSuccess: () => {
      /*
       * The lead leaves the pool the moment it has an owner, so the pool query
       * is not merely stale — its answer changed. `["leads"]` covers it and the
       * Leads table; `["hot-leads"]` because the new owner's panel is scoped by
       * owner and this lead may now belong on it.
       */
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["hot-leads"] });
    },
  });

  return (
    <div className="flex flex-col items-end gap-1">
      <Select
        onValueChange={(producerId) => assign.mutate(producerId)}
        disabled={assign.isPending || users.isPending}
      >
        <SelectTrigger
          size="sm"
          className="w-full sm:w-44"
          aria-label={`Assign ${leadName} to a producer`}
        >
          <SelectValue placeholder="Assign to…" />
        </SelectTrigger>
        <SelectContent>
          {/* Deactivated accounts, non-producers and anyone not available are
              all excluded server-side — see `ASSIGNABLE_PRODUCERS`. */}
          {producers.map((user) => (
            <SelectItem key={user._id} value={user._id}>
              {[user.firstName, user.lastName]
                .filter(Boolean)
                .join(" ")
                .trim() || user.email}
            </SelectItem>
          ))}
          {/* A sentence, not an empty popover: with every producer busy or
              away, a blank list reads as broken. */}
          {users.isSuccess && producers.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              No producers available
            </p>
          )}
        </SelectContent>
      </Select>

      {assign.isPending && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Assigning…
        </p>
      )}

      {assign.isError && (
        <p className="flex items-start gap-1.5 text-right text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          {/* The API's message names the winner of a race, or the reason a
              deactivated target was refused. Only fall back when there is
              genuinely nothing to say. */}
          {(assign.error as Error).message || "Couldn't assign this lead."}
        </p>
      )}
    </div>
  );
}
