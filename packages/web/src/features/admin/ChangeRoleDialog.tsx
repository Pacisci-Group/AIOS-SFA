import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api-client";
import { listRoles } from "@/lib/roles-api";
import { updateUserRoles, type AgencyUser } from "@/lib/users-api";

interface ChangeRoleDialogProps {
  user: AgencyUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Change which roles a user holds.
 *
 * `PATCH /users/:id/roles` has been implemented and permissioned since day one
 * with no client and no screen, which is why the invite dialog's "Adjustable
 * afterwards" was untrue and the only way to change a role was a database edit.
 *
 * Multi-select because the model is multi-role: permissions union across the
 * roles held, and the data scope becomes the **widest** of them — so adding an
 * agency-scoped role to a producer widens their visibility on every page, not
 * just the new one. The description under the list says so, because that is the
 * consequence people get wrong.
 *
 * The owner-protection rules (403 for demoting another owner, 409 for the last
 * one) are enforced server-side and surfaced from the response. They are not
 * re-derived here: the client cannot see who else holds the owner role, so any
 * local guess would be wrong exactly when it mattered.
 */
export function ChangeRoleDialog({
  user,
  open,
  onOpenChange,
}: ChangeRoleDialogProps) {
  const queryClient = useQueryClient();
  const { user: currentUser, refreshUser } = useAuth();
  const [selected, setSelected] = useState<string[]>([]);

  const { data: roles, isPending } = useQuery({
    queryKey: ["roles"],
    queryFn: listRoles,
    enabled: open,
  });

  // Re-seed each time it opens: the dialog stays mounted between rows, so
  // without this the previous user's selection would be shown for the next one.
  useEffect(() => {
    if (open) setSelected(user.roleIds.map((role) => role._id));
  }, [open, user]);

  const save = useMutation({
    mutationFn: () => updateUserRoles(user._id, selected),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      // Editing your own roles changes your own menu and route access. Without
      // this the sidebar keeps offering pages that have already started 403ing.
      if (currentUser?.id === user._id) await refreshUser();
      toast.success("Roles updated", {
        description:
          currentUser?.id === user._id
            ? "Your own access has been updated."
            : "They pick up the change on their next request.",
      });
      onOpenChange(false);
    },
    onError: (error) => {
      // 403 (demoting another owner) and 409 (the last owner) both arrive with a
      // sentence that names the reason; show it rather than a generic failure.
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Could not update this user's roles.",
      );
    },
  });

  const toggle = (roleId: string) => {
    setSelected((current) =>
      current.includes(roleId)
        ? current.filter((id) => id !== roleId)
        : [...current, roleId],
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change roles</DialogTitle>
          <DialogDescription>
            {user.firstName || user.lastName
              ? `${[user.firstName, user.lastName].filter(Boolean).join(" ")} · ${user.email}`
              : user.email}
          </DialogDescription>
        </DialogHeader>

        {isPending ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Loading roles…
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {(roles ?? []).map((role) => (
              <div key={role._id} className="flex items-start gap-3">
                <Checkbox
                  id={`role-${role._id}`}
                  checked={selected.includes(role._id)}
                  onCheckedChange={() => toggle(role._id)}
                />
                <div className="grid gap-0.5 leading-none">
                  <Label
                    htmlFor={`role-${role._id}`}
                    className="cursor-pointer text-sm font-medium"
                  >
                    {role.name}
                  </Label>
                  {role.description ? (
                    <p className="text-xs text-muted-foreground">
                      {role.description}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
            <p className="pt-1 text-xs text-muted-foreground">
              Several roles can be held at once. Permissions add together, and
              the widest data scope wins — so one agency-wide role widens what
              they see on every page.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={save.isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : null}
            Save roles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
