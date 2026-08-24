import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Trash2 } from "lucide-react";
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
import { usePermissions } from "@/hooks/usePermissions";
import { ApiError } from "@/lib/api-client";
import {
  resendInvite,
  revokeInvite,
  userStatus,
  type AgencyUser,
} from "@/lib/users-api";

interface InviteRowActionsProps {
  user: AgencyUser;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * Resend / Revoke for a **pending** invite (PAC-58 Scope 3).
 *
 * Renders nothing for an active user — both endpoints reject one with a 409, so
 * offering the controls would only produce an error the owner cannot act on.
 * Also self-gates on `agency:users:write`.
 *
 * Deliberately two buttons rather than a `⋯` dropdown: the revoke confirmation
 * is an `AlertDialog`, and nesting one inside a `DropdownMenu` needs the menu's
 * close and the dialog's focus trap to be hand-sequenced or the dialog closes
 * with the menu. Two buttons on a row that already has room avoids all of it.
 */
export function InviteRowActions({ user }: InviteRowActionsProps) {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const resend = useMutation({
    mutationFn: () => resendInvite(user._id),
    onSuccess: (result) => {
      toast.success("Invite resent", {
        description: `The previous link no longer works. The new one expires ${new Date(
          result.expiresAt,
        ).toLocaleDateString()}.`,
      });
    },
    onError: (error) => {
      // Covers the per-user cooldown (409) as well as transport failures; the
      // server's message names the wait, so it is shown as-is.
      toast.error(errorMessage(error, "Could not resend the invite."));
    },
  });

  const revoke = useMutation({
    mutationFn: () => revokeInvite(user._id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Invite revoked", {
        description: "The link in their email no longer works.",
      });
      setConfirmOpen(false);
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Could not revoke the invite."));
    },
  });

  // `userStatus`, not `!user.isActive`. That older check was written when
  // `isActive: false` could only mean "pending invite"; it now also covers a
  // removed employee, and matching on it would offer "Resend" against someone
  // the owner had just removed. The server refuses that (see
  // `UsersService.findPendingInvite`) — this keeps the button from appearing at
  // all. `UserRowActions` owns active and deactivated rows.
  if (userStatus(user) !== "invited" || !can("agency:users:write")) return null;

  const busy = resend.isPending || revoke.isPending;

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          disabled={busy}
          onClick={() => resend.mutate()}
          aria-label={`Resend invite to ${user.email}`}
        >
          {resend.isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Send size={12} />
          )}
          Resend
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
          disabled={busy}
          onClick={() => setConfirmOpen(true)}
          aria-label={`Revoke invite to ${user.email}`}
        >
          <Trash2 size={12} />
          Revoke
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this invite?</AlertDialogTitle>
            <AlertDialogDescription>
              The link sent to {user.email} stops working and the pending account
              is removed. You can invite the same address again afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoke.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={revoke.isPending}
              onClick={(e) => {
                // Keep the dialog up while the request is in flight — Radix
                // closes on action click by default, which would flash the row
                // back before the list had refetched.
                e.preventDefault();
                revoke.mutate();
              }}
            >
              {revoke.isPending && (
                <Loader2 size={14} className="animate-spin" />
              )}
              Revoke invite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
