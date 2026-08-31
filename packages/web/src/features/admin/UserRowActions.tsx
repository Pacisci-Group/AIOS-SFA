import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, UserCheck, UserCog } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { usePermissions } from "@/hooks/usePermissions";
import { ChangeRoleDialog } from "./ChangeRoleDialog";
import { ApiError } from "@/lib/api-client";
import {
  deactivateUser,
  reactivateUser,
  userStatus,
  type AgencyUser,
  type ReleasedWork,
} from "@/lib/users-api";

interface UserRowActionsProps {
  user: AgencyUser;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** "3 open tickets and 1 rotation entry", or null when nothing was freed. */
function releasedSummary(released: ReleasedWork): string | null {
  const parts: string[] = [];
  if (released.ticketsUnassigned > 0) {
    parts.push(
      `${released.ticketsUnassigned} open ticket${released.ticketsUnassigned === 1 ? "" : "s"}`,
    );
  }
  if (released.rotationsDeactivated > 0) {
    parts.push(
      `${released.rotationsDeactivated} rotation entr${released.rotationsDeactivated === 1 ? "y" : "ies"}`,
    );
  }
  return parts.length ? parts.join(" and ") : null;
}

/**
 * Remove / Reactivate for a real employee — the counterpart to
 * `InviteRowActions`, which owns pending invites.
 *
 * The two are deliberately separate components rather than one branching on
 * status: they share no mutation, no copy and no confirmation text, and the
 * split is what keeps each one's "when do I render?" rule a single line.
 *
 * Renders nothing for a pending invite (that is `InviteRowActions`' row), for a
 * caller without `agency:users:write`, or for the signed-in user themselves —
 * the API rejects self-removal with a 400, so showing the button would only
 * produce an error they cannot act on. Same self-gating principle
 * `InviteRowActions` applies to active users.
 */
export function UserRowActions({ user }: UserRowActionsProps) {
  const { can } = usePermissions();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);

  const status = userStatus(user);

  const deactivate = useMutation({
    mutationFn: () => deactivateUser(user._id),
    onSuccess: (released) => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      const freed = releasedSummary(released);
      toast.success("User removed", {
        description: freed
          ? `They can no longer sign in. ${freed} went back to the unassigned queue.`
          : "They can no longer sign in. Their history stays on record.",
      });
      setConfirmOpen(false);
    },
    onError: (error) => {
      // Covers the last-owner (409) and self-removal (400) guards as well as
      // transport failures; the server's message names the reason, so it is
      // shown as-is.
      toast.error(errorMessage(error, "Could not remove this user."));
    },
  });

  const reactivate = useMutation({
    mutationFn: () => reactivateUser(user._id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User reactivated", {
        description:
          "They can sign in again. Work released when they were removed stays where it is.",
      });
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Could not reactivate this user."));
    },
  });

  if (status === "invited" || !can("agency:users:write")) return null;
  if (user.isPlatformAdmin) return null;

  if (status === "deactivated") {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        disabled={reactivate.isPending}
        onClick={() => reactivate.mutate()}
        aria-label={`Reactivate ${user.email}`}
      >
        {reactivate.isPending ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <UserCheck size={12} />
        )}
        Reactivate
      </Button>
    );
  }

  // Active.
  //
  // Changing roles is offered on every active row **including your own** — an
  // owner giving up their own owner role is a legitimate, server-supported move
  // (it is only taking it off *someone else* that is blocked). Removal is not:
  // self-removal 400s, so that button stays hidden on your own row rather than
  // letting the owner discover the error by clicking it.
  const isSelf = currentUser?.id === user._id;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setRolesOpen(true)}
        aria-label={`Change roles for ${user.email}`}
      >
        <UserCog size={12} />
        Roles
      </Button>

      <ChangeRoleDialog
        user={user}
        open={rolesOpen}
        onOpenChange={setRolesOpen}
      />

      {isSelf ? null : (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
          disabled={deactivate.isPending}
          onClick={() => setConfirmOpen(true)}
          aria-label={`Remove ${user.email}`}
        >
          <Trash2 size={12} />
          Remove
        </Button>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {user.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              They are signed out immediately and can no longer access the
              agency. Their past work stays on record under their name, and any
              open tickets they hold go back to the unassigned queue for someone
              else to pick up. You can reactivate them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deactivate.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deactivate.isPending}
              onClick={(e) => {
                // Keep the dialog up while the request is in flight — Radix
                // closes on action click by default, which would flash the row
                // back before the list had refetched. Same reasoning as
                // `InviteRowActions`.
                e.preventDefault();
                deactivate.mutate();
              }}
            >
              {deactivate.isPending && (
                <Loader2 size={14} className="animate-spin" />
              )}
              Remove user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
