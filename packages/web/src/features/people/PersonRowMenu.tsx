import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  ClipboardCheck,
  Contact,
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
import { AgencyPermission } from "@sfa/shared";
import { useAuth } from "@/contexts/auth-context";
import { usePermissions } from "@/hooks/usePermissions";
import { ApiError } from "@/lib/api-client";
import {
  reactivateUser,
  resendInvite,
  revokeInvite,
  sendPasswordReset,
  type AgencyUser,
  agencyUserOptionsKey,
} from "@/lib/users-api";
import { peopleKeys } from "@/lib/people-api";
import { ChangeRoleDialog } from "@/features/admin/ChangeRoleDialog";
import { TransferWorkDialog } from "@/features/admin/TransferWorkDialog";

/** Which confirmation is open. `null` closes the dialog. */
type Confirmation = "revoke" | "reset";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * Every per-person action, behind one `⋯` on the row — and on the profile
 * page header, which passes the same row (PAC-162).
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
 * ## What renders when
 *
 * * **View profile** → always; the row's primary action, repeated here for
 *   the keyboard and for the profile page itself (where it is hidden).
 * * **Complete onboarding…** → a `pending_onboarding` row, for
 *   `agency:hr:admin`; opens the profile with the onboarding sheet up.
 * * **invited** → Resend, Revoke. Both endpoints 409 on an active user.
 * * **active** / **pending_onboarding** → Change roles (including on your own row: giving up your own
 *   owner role is server-supported, it is taking it off *someone else* that is
 *   blocked), Send password reset, Remove (never on your own row — self-removal
 *   400s, so offering it would only teach the error by clicking it).
 * * **deactivated** → Reactivate.
 * * **Transfer work…** (PAC-136) on active and removed rows, for holders of
 *   `agency:work_transfer:write` + `agency:users:read` **in an agency-wide
 *   role** — a separate grant from `agency:users:write`.
 *   "Remove from agency" opens the same dialog with an optional successor.
 * * Everything above also needs `agency:users:write`; a platform admin's row
 *   gets none of it.
 * * **Permissions** needs `agency:roles:read` — the permission its *route*
 *   demands. The row used to link there unconditionally, so a directory-only
 *   reader clicking any row was redirected to the landing page.
 */
export function PersonRowMenu({
  user,
  onProfile = false,
}: {
  user: AgencyUser;
  /** Rendered on the profile page itself: no "View profile" item. */
  onProfile?: boolean;
}) {
  const { can } = usePermissions();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();

  const [menuOpen, setMenuOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [workDialog, setWorkDialog] = useState<"transfer" | "remove" | null>(
    null,
  );

  const invalidateUsers = () => {
    void queryClient.invalidateQueries({ queryKey: ["users"] });
    // The profile page renders the same person (PAC-162).
    void queryClient.invalidateQueries({
      queryKey: peopleKeys.profile(user._id),
    });
    // Deactivating or reactivating changes who is assignable, and the
    // pickers key on `agency-users` rather than `users`.
    void queryClient.invalidateQueries({ queryKey: agencyUserOptionsKey });
  };

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

  const status = user.status;
  const isSelf = currentUser?.id === user._id;
  // An account that can sign in: the HR onboarding does not change what the
  // owner may do with it.
  const accountActive = status === "active" || status === "pending_onboarding";
  const mayOnboard =
    status === "pending_onboarding" &&
    can(AgencyPermission.HrAdmin) &&
    !user.isPlatformAdmin;
  const mayManage =
    can("agency:users:write") && !user.isPlatformAdmin;
  const mayEditPermissions = can("agency:roles:read");
  // The permission alone is not enough: only an agency-wide role may transfer
  // (the API refuses a branch- or own-scoped holder with a 403).
  const canTransfer =
    can(AgencyPermission.WorkTransfer) &&
    can(AgencyPermission.UsersRead) &&
    (currentUser?.dataScope === "agency" || !!currentUser?.isPlatformAdmin);
  const mayTransfer =
    canTransfer && !user.isPlatformAdmin && status !== "invited";

  const busy =
    resend.isPending ||
    revoke.isPending ||
    reset.isPending ||
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

  // On the profile page the menu holds only the actions; on a row it always
  // has View profile, so a reader with nothing else still gets a menu.
  if (onProfile && !mayManage && !mayEditPermissions && !mayTransfer && !mayOnboard) {
    return null;
  }

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

        <DropdownMenuContent align="end" className="w-56">
          {!onProfile && (
            <DropdownMenuItem asChild>
              <Link to={`/people/${user._id}`}>
                <Contact className="size-4" />
                View profile
              </Link>
            </DropdownMenuItem>
          )}
          {mayOnboard && (
            <DropdownMenuItem asChild>
              <Link to={`/people/${user._id}?onboard=1`}>
                <ClipboardCheck className="size-4" />
                Complete onboarding…
              </Link>
            </DropdownMenuItem>
          )}
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
              <DropdownMenuSeparator />
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

          {mayManage && accountActive && (
            <>
              <DropdownMenuSeparator />
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
                    onSelect={choose(() => setWorkDialog("remove"))}
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
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={busy}
                onSelect={choose(() => reactivate.mutate())}
              >
                <UserCheck className="size-4" />
                Reactivate
              </DropdownMenuItem>
            </>
          )}
          {mayTransfer && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={busy}
                onSelect={choose(() => setWorkDialog("transfer"))}
              >
                <ArrowRightLeft className="size-4" />
                Transfer work…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <TransferWorkDialog
        user={user}
        open={workDialog !== null}
        onOpenChange={(next) => !next && setWorkDialog(null)}
        mode={workDialog ?? "transfer"}
        canTransfer={canTransfer}
      />

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
