import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Loader2 } from "lucide-react";
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
  sendPasswordReset,
  userStatus,
  type AgencyUser,
} from "@/lib/users-api";

interface PasswordResetRowActionsProps {
  user: AgencyUser;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * Send a password-reset email to an **active** employee (PAC-79).
 *
 * The only way back in for the users the SmartSuite migration left with a
 * random hex string where a bcrypt digest should be: they cannot sign in, and
 * they cannot be re-invited because the invite endpoints refuse an active user.
 *
 * Renders nothing for invited or deactivated rows — the endpoint answers both
 * with a 409, so offering the control would produce an error rather than an
 * action. Self-gates on `agency:users:write`, the same permission that already
 * means "manage employees"; PAC-76 made that call for removal and inventing a
 * second one here would leave every existing owner role without it.
 *
 * ## Why this is a confirmation and "Resend invite" is not
 * Resending an invite re-sends something the recipient was already expecting.
 * This mails a credential for an account that already exists and has data in
 * it, unprompted — and the row carries a stretched `<Link>` overlay to the
 * permissions page, which makes a mis-click land on a real person. One dialog
 * is worth it.
 */
export function PasswordResetRowActions({
  user,
}: PasswordResetRowActionsProps) {
  const { can } = usePermissions();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const send = useMutation({
    mutationFn: () => sendPasswordReset(user._id),
    onSuccess: (result) => {
      // No `invalidateQueries(['users'])` — nothing in the directory changes,
      // exactly as `resendInvite` handles it. Refetching here would only make
      // the list flicker.
      toast.success("Password reset sent", {
        description: `${user.email} can set a new password until ${new Date(
          result.expiresAt,
        ).toLocaleString()}. Any earlier link has stopped working.`,
      });
      setConfirmOpen(false);
    },
    onError: (error) => {
      // Covers the per-user cooldown (409), which names the wait, as well as
      // transport failures. The server's message is shown as-is.
      toast.error(errorMessage(error, "Could not send the password reset."));
    },
  });

  if (userStatus(user) !== "active" || !can("agency:users:write")) return null;
  // Not the agency's to manage, and `GET /users` already hides them — but the
  // guard is cheap and keeps this consistent with `UserRowActions`.
  if (user.isPlatformAdmin) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        disabled={send.isPending}
        onClick={() => setConfirmOpen(true)}
        aria-label={`Send a password reset to ${user.email}`}
      >
        {send.isPending ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <KeyRound size={12} />
        )}
        Reset password
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send a password reset?</AlertDialogTitle>
            <AlertDialogDescription>
              {user.email} gets an email with a link to set a new password. The
              link expires in a day and can only be used once. Their current
              password keeps working until they use it, and any earlier reset
              link stops working now.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={send.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={send.isPending}
              onClick={(e) => {
                // Keep the dialog up while the request is in flight — Radix
                // closes on action click by default, which would hide the
                // cooldown 409 behind a dialog that had already dismissed.
                e.preventDefault();
                send.mutate();
              }}
            >
              {send.isPending && <Loader2 size={14} className="animate-spin" />}
              Send reset link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
