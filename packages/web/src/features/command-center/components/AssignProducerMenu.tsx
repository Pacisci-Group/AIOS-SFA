import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UserAvailability } from "@sfa/shared";
import { reassignLead } from "@/lib/leads-api";
import { agencyUserOptionsKey, listUserOptions } from "@/lib/users-api";

/**
 * Who this picker lists. An allow-list, not "everyone except X": a status added
 * to `USER_AVAILABILITIES` later (`inactive` is on its way) stays out of the
 * picker until someone decides it belongs here, rather than slipping in.
 */
const ASSIGNABLE_AVAILABILITIES: ReadonlySet<UserAvailability> =
  new Set<UserAvailability>(["available", "busy"]);

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
    queryKey: agencyUserOptionsKey,
    queryFn: listUserOptions,
  });

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
          {/* Deactivated accounts are excluded server-side by
              `/users/options` — assigning to one is how a lead quietly reaches
              nobody. Availability is filtered here because the other pickers
              sharing that endpoint want everyone. */}
          {(users.data ?? [])
            .filter((user) => ASSIGNABLE_AVAILABILITIES.has(user.availability))
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
