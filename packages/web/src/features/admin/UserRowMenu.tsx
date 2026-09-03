import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  Loader2,
  MoreHorizontal,
  Send,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserCog,
} from "lucide-react";
import { Link } from "react-router-dom";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/auth-context";
import { usePermissions } from "@/hooks/usePermissions";
import { ApiError } from "@/lib/api-client";
import {
  deactivateUser,
  reactivateUser,
  resendInvite,
  revokeInvite,
  sendPasswordReset,
  userStatus,
  type AgencyUser,
  type ReleasedWork,
} from "@/lib/users-api";
import { ChangeRoleDialog } from "./ChangeRoleDialog";

/** Which confirmation is open. `null` closes the dialog. */
type Confirmation = "revoke" | "remove" | "reset";

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
 * Every per-user action, behind one `⋯` on the row.
 *
 * ## Why one menu instead of the three components it replaces
 *
 * `InviteRowActions`, `PasswordResetRowActions` and `UserRowActions` each
 * rendered their own labelled ghost buttons, and an active row showed three of
 * them at once — "Reset password · Roles · Remove", repeated down every row of
 * the directory. Eleven employees meant thirty-three buttons competing with the
 * names they belong to, and the row's own primary action (open permissions) was
 * the one thing with no label at all. The actions are unchanged; only their
 * affordance is.
 *
 * The old split was justified in `InviteRowActions` on the grounds that an
 * `AlertDialog` nested inside a `DropdownMenu` needs its close and focus trap
 * hand-sequenced. That is true of a *nested* dialog. Here every dialog is a
 * **sibling** of the menu, driven by state the menu only writes to, so the menu
 * closing never unmounts an open dialog. The menu is controlled and each item
 * calls `preventDefault()` before closing it explicitly, so the order is ours
 * rather than a race between Radix's focus restore and the dialog's autofocus.
 *
 * ## What renders when — unchanged from the three components
 *
 * * **invited** → Resend, Revoke. Both endpoints 409 on an active user.
 * * **active** → Change roles (including on your own row: giving up your own
 *   owner role is server-supported, it is taking it off *someone else* that is
 *   blocked), Send password reset, Remove (never on your own row — self-removal
 *   400s, so offering it would only teach the error by clicking it).
 * * **deactivated** → Reactivate.
 * * Everything above also needs `agency:users:write`; a platform admin's row
 *   gets none of it.
 * * **Permissions** needs `agency:roles:read` — the permission its *route*
 *   demands. The row used to link there unconditionally, so a directory-only
 *   reader clicking any row was redirected to the landing page.
 */
export function UserRowMenu({ user }: { user: AgencyUser }) {
  const { can } = usePermissions();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();

  const [menuOpen, setMenuOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);

  const invalidateUsers = () =>
    void queryClient.invalidateQueries({ queryKey: ["users"] });

  const resend = useMutation({
    mutationFn: () => resendInvite(user._id),
    onSuccess: (result) => {
      toast.success("Invite resent", {
        description: `The previous link no longer works. The new one expires ${new Date(
          result.expiresAt,
        ).toLocaleDateString()}.`,
      });
    },
    // Covers the per-user cooldown (409) as well as transport failures; the
    // server's message names the wait, so it is shown as-is.
    onError: (error) =>
      toast.error(errorMessage(error, "Could not resend the invite.")),
  });

  const revoke = useMutation({
    mutationFn: () => revokeInvite(user._id),
    onSuccess: () => {
      invalidateUsers();
      toast.success("Invite revoked", {
        description: "The link in their email no longer works.",
      });
      setConfirm(null);
    },
    onError: (error) =>
      toast.error(errorMessage(error, "Could not revoke the invite.")),
  });

  const reset = useMutation({
    mutationFn: () => sendPasswordReset(user._id),
    onSuccess: (result) => {
      // No `invalidateUsers()` — nothing in the directory changes, exactly as
      // the resend above. Refetching here would only make the list flicker.
      toast.success("Password reset sent", {
        description: `${user.email} can set a new password until ${new Date(
          result.expiresAt,
        ).toLocaleString()}. Any earlier link has stopped working.`,
      });
      setConfirm(null);
    },
    onError: (error) =>
      toast.error(errorMessage(error, "Could not send the password reset.")),
  });

  const deactivate = useMutation({
    mutationFn: () => deactivateUser(user._id),
    onSuccess: (released) => {
      invalidateUsers();
      const freed = releasedSummary(released);
      toast.success("User removed", {
        description: freed
          ? `They can no longer sign in. ${freed} went back to the unassigned queue.`
          : "They can no longer sign in. Their history stays on record.",
      });
      setConfirm(null);
    },
    // Covers the last-owner (409) and self-removal (400) guards as well as
    // transport failures; the server's message names the reason.
    onError: (error) =>
      toast.error(errorMessage(error, "Could not remove this user.")),
  });

  const reactivate = useMutation({
    mutationFn: () => reactivateUser(user._id),
    onSuccess: () => {
      invalidateUsers();
      toast.success("User reactivated", {
        description:
          "They can sign in again. Work released when they were removed stays where it is.",
      });
    },
    onError: (error) =>
      toast.error(errorMessage(error, "Could not reactivate this user.")),
  });

  const status = userStatus(user);
  const isSelf = currentUser?.id === user._id;
  const mayManage =
    can("agency:users:write") && !user.isPlatformAdmin;
  const mayEditPermissions = can("agency:roles:read");

  const busy =
    resend.isPending ||
    revoke.isPending ||
    reset.isPending ||
    deactivate.isPending ||
    reactivate.isPending;

  /** Close the menu ourselves, then open whatever the item asked for. */
  const choose = (run: () => void) => (event: Event) => {
    event.preventDefault();
    setMenuOpen(false);
    run();
  };

  const CONFIRMATIONS: Record<
    Confirmation,
    {
      title: ReactNode;
      description: ReactNode;
      action: string;
      pending: boolean;
      run: () => void;
    }
  > = {
    revoke: {
      title: "Revoke this invite?",
      description: `The link sent to ${user.email} stops working and the pending account is removed. You can invite the same address again afterwards.`,
      action: "Revoke invite",
      pending: revoke.isPending,
      run: () => revoke.mutate(),
    },
    remove: {
      title: `Remove ${user.email}?`,
      description:
        "They are signed out immediately and can no longer access the agency. Their past work stays on record under their name, and any open tickets they hold go back to the unassigned queue for someone else to pick up. You can reactivate them later.",
      action: "Remove user",
      pending: deactivate.isPending,
      run: () => deactivate.mutate(),
    },
    /*
     * A confirmation where "Resend invite" has none, deliberately. Resending an
     * invite re-sends something the recipient was already expecting; this mails
     * a credential for an account that already exists and has data in it,
     * unprompted.
     */
    reset: {
      title: "Send a password reset?",
      description: `${user.email} gets an email with a link to set a new password. The link expires in a day and can only be used once. Their current password keeps working until they use it, and any earlier reset link stops working now.`,
      action: "Send reset link",
      pending: reset.isPending,
      run: () => reset.mutate(),
    },
  };

  const open = confirm ? CONFIRMATIONS[confirm] : null;

  // Nothing to offer: a reader with neither write access nor the permissions
  // page renders no trigger at all rather than an empty menu.
  if (!mayManage && !mayEditPermissions) return null;

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${user.email}`}
            className="text-muted-foreground hover:text-foreground data-[state=open]:bg-muted"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MoreHorizontal className="size-4" />
            )}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-52">
          {mayEditPermissions && (
            <DropdownMenuItem asChild>
              <Link to={`/settings/users/${user._id}/permissions`}>
                <ShieldCheck className="size-4" />
                Permissions
              </Link>
            </DropdownMenuItem>
          )}

          {mayManage && status === "invited" && (
            <>
              {mayEditPermissions && <DropdownMenuSeparator />}
              <DropdownMenuItem
                disabled={busy}
                onSelect={choose(() => resend.mutate())}
              >
                <Send className="size-4" />
                Resend invite
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={busy}
                onSelect={choose(() => setConfirm("revoke"))}
              >
                <Trash2 className="size-4" />
                Revoke invite
              </DropdownMenuItem>
            </>
          )}

          {mayManage && status === "active" && (
            <>
              {mayEditPermissions && <DropdownMenuSeparator />}
              <DropdownMenuItem
                disabled={busy}
                onSelect={choose(() => setRolesOpen(true))}
              >
                <UserCog className="size-4" />
                Change roles
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy}
                onSelect={choose(() => setConfirm("reset"))}
              >
                <KeyRound className="size-4" />
                Send password reset
              </DropdownMenuItem>
              {!isSelf && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={busy}
                    onSelect={choose(() => setConfirm("remove"))}
                  >
                    <Trash2 className="size-4" />
                    Remove from agency
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}

          {mayManage && status === "deactivated" && (
            <>
              {mayEditPermissions && <DropdownMenuSeparator />}
              <DropdownMenuItem
                disabled={busy}
                onSelect={choose(() => reactivate.mutate())}
              >
                <UserCheck className="size-4" />
                Reactivate
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangeRoleDialog
        user={user}
        open={rolesOpen}
        onOpenChange={setRolesOpen}
      />

      <AlertDialog
        open={open !== null}
        onOpenChange={(next) => !next && setConfirm(null)}
      >
        {open && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{open.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {open.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={open.pending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={open.pending}
                onClick={(event) => {
                  // Keep the dialog up while the request is in flight — Radix
                  // closes on action click by default, which would flash the
                  // row back before the list had refetched, and would hide a
                  // cooldown 409 behind a dialog that had already dismissed.
                  event.preventDefault();
                  open.run();
                }}
              >
                {open.pending && <Loader2 className="size-4 animate-spin" />}
                {open.action}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </>
  );
}
