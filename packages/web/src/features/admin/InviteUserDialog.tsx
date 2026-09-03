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
import { listBranches } from "@/lib/branches-api";
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

  // Both, because the dialog does both: `POST /users/invite` needs
  // `agency:users:write`, and its role picker calls `GET /roles`, which needs
  // `agency:roles:read`. Gating on the first alone opened the dialog for a role
  // that then got an empty picker and a 403 in the console.
  const allowed = can("agency:users:write") && can("agency:roles:read");

  const rolesQuery = useQuery({
    queryKey: ["roles"],
    queryFn: listRoles,
    // Nothing to fetch until the owner opens the dialog.
    enabled: open && allowed,
  });

  // The branch picker is a *secondary* read: `POST /users/invite` does not
  // require `agency:branches:read`, so a caller who can invite but cannot list
  // branches must still get a working form — hence its own gate here rather
  // than being folded into `allowed`, and `retry: false` so a 403 fails once
  // instead of three times before the picker disappears.
  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: listBranches,
    enabled: open && allowed && can("agency:branches:read"),
    retry: false,
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

  // Preselect the agency's default branch — most invitees belong to it, and an
  // empty picker would quietly recreate the branchless users this replaced.
  // Declared *after* the reset effect so the two fire in that order on a
  // reopen where the branch list is already cached; guarded on the current
  // value so a re-render can't overwrite a choice the owner has made.
  const branches = branchesQuery.data;
  useEffect(() => {
    if (!open || !branches?.length) return;
    if (form.state.values.branchId) return;
    // The API sorts `isDefault` first, but the fallback is what keeps this
    // honest for agencies predating the default-branch fix, which have none.
    const preferred = branches.find((b) => b.isDefault) ?? branches[0];
    form.setFieldValue("branchId", preferred._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branches]);

  if (!allowed) return null;

  // `triggerLabel` keeps the closed select to the role's name. The description
  // is a full sentence — rendered on the trigger it blew past the dialog's
  // edges, since the trigger is a one-line `whitespace-nowrap` control.
  const roleOptions = (rolesQuery.data ?? []).map((role) => ({
    value: role._id,
    triggerLabel: role.name,
    label: role.description ? (
      <span className="flex min-w-0 flex-col items-start gap-0.5 text-left">
        <span>{role.name}</span>
        <span className="text-xs whitespace-normal text-muted-foreground">
          {role.description}
        </span>
      </span>
    ) : (
      role.name
    ),
  }));

  const branchOptions = (branches ?? []).map((branch) => ({
    value: branch._id,
    label: branch.isDefault ? `${branch.name} (default)` : branch.name,
    triggerLabel: branch.name,
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
                  // Without this the longest description sets the menu's width
                  // and the panel spills out of the dialog.
                  contentClassName="max-w-[var(--radix-select-trigger-width)]"
                />
              )}
            </form.AppField>

            {rolesQuery.isError && (
              <p className="text-sm text-destructive">
                Could not load roles — {(rolesQuery.error as Error).message}
              </p>
            )}

            {/*
              Rendered only once there is something to choose from. A failed or
              forbidden `GET /branches` leaves no picker and no error copy — the
              invite still works, it just creates a branchless user, and nothing
              here is something the owner could act on.

              In practice this branch is unreachable: `agency:users:write` is
              owner-only and the owner template carries every agency permission.
              It matters because there is still **no UI that changes a user's
              branch after the invite**, so silently skipping the picker would
              be a dead end rather than a delay.
            */}
            {branchOptions.length > 0 && (
              <form.AppField name="branchId">
                {(f) => (
                  <f.SelectField
                    label="Branch"
                    options={branchOptions}
                    placeholder="Select a branch"
                    description="Where they work. Defaults to the agency's main branch."
                    triggerClassName="w-full bg-card border-border"
                    contentClassName="max-w-[var(--radix-select-trigger-width)]"
                  />
                )}
              </form.AppField>
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
