import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { FormError, FormGrid } from "@/components/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAppForm } from "@/hooks/form";
import { usePermissions } from "@/hooks/usePermissions";
import { ApiError } from "@/lib/api-client";
import { listRoles } from "@/lib/roles-api";
import { inviteUser } from "@/lib/users-api";
import {
  EMPTY_INVITE,
  inviteFormSchema,
  toInviteUserInput,
} from "./invite-schema";

/**
 * Invite an employee by name, email and role (PAC-58 Scope 3).
 *
 * Self-gating on `agency:users:write` and returning `null`, matching
 * `EditContactDialog` — the page doesn't have to check first. The gate is about
 * showing the control; `POST /users/invite` enforces the same permission.
 */
export function InviteUserDialog() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const allowed = can("agency:users:write");

  const rolesQuery = useQuery({
    queryKey: ["roles"],
    queryFn: listRoles,
    // Nothing to fetch until the owner opens the dialog.
    enabled: open && allowed,
  });

  const mutation = useMutation({
    mutationFn: inviteUser,
    onSuccess: (result) => {
      // The new row renders with the existing amber "Invited" badge.
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Invite sent", {
        description: `They have until ${new Date(
          result.expiresAt,
        ).toLocaleDateString()} to set their password.`,
      });
      setOpen(false);
    },
    onError: (error) => {
      // 409 is the one error with a specific remedy (the address is taken, and
      // the server says whether by a member or a pending invite), so it is
      // surfaced verbatim instead of behind a generic failure message.
      setSubmitError(
        error instanceof ApiError
          ? error.message
          : "Could not send the invite. Try again.",
      );
    },
  });

  const form = useAppForm({
    defaultValues: EMPTY_INVITE,
    validators: { onBlur: inviteFormSchema },
    onSubmit: ({ value }) => {
      setSubmitError(null);
      mutation.mutate(toInviteUserInput(value));
    },
  });

  // Reset on open so a cancelled or failed attempt doesn't persist into the
  // next one. Same reasoning as `EditContactDialog`.
  useEffect(() => {
    if (!open) return;
    form.reset(EMPTY_INVITE);
    setSubmitError(null);
    mutation.reset();
    // `form` is a stable instance held in useState by the library.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!allowed) return null;

  const roleOptions = (rolesQuery.data ?? []).map((role) => ({
    value: role._id,
    label: role.description ? (
      <span className="flex flex-col">
        <span>{role.name}</span>
        <span className="text-xs text-muted-foreground">
          {role.description}
        </span>
      </span>
    ) : (
      role.name
    ),
  }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="brand" size="sm" className="gap-1.5">
          <UserPlus size={14} />
          Invite user
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a user</DialogTitle>
          <DialogDescription>
            They get an email with a link to set their own password. Nobody
            shares credentials.
          </DialogDescription>
        </DialogHeader>

        <form.AppForm>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
            className="space-y-4"
            noValidate
          >
            <FormError>{submitError}</FormError>

            <FormGrid>
              <form.AppField name="firstName">
                {(f) => (
                  <f.TextField
                    label="First name"
                    autoComplete="off"
                    inputClassName="bg-card border-border"
                  />
                )}
              </form.AppField>
              <form.AppField name="lastName">
                {(f) => (
                  <f.TextField
                    label="Last name"
                    autoComplete="off"
                    inputClassName="bg-card border-border"
                  />
                )}
              </form.AppField>
            </FormGrid>

            <form.AppField name="email">
              {(f) => (
                <f.TextField
                  label="Email"
                  type="email"
                  autoComplete="off"
                  description="The invite link is sent here."
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>

            <form.AppField name="roleId">
              {(f) => (
                <f.SelectField
                  label="Role"
                  options={roleOptions}
                  placeholder={
                    rolesQuery.isLoading ? "Loading roles…" : "Select a role"
                  }
                  disabled={rolesQuery.isLoading || roleOptions.length === 0}
                  description="Sets what they can see and do. Adjustable afterwards."
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>

            {rolesQuery.isError && (
              <p className="text-sm text-destructive">
                Could not load roles — {(rolesQuery.error as Error).message}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                Send invite
              </Button>
            </DialogFooter>
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
