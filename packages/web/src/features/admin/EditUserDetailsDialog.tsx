import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { AllstateCodeFields } from "@/components/allstate-codes/AllstateCodeFields";
import {
  allstateCodeConflict,
  allstateCodesForUpdate,
  allstateCodesFormValues,
  allstateCodesShape,
} from "@/components/allstate-codes/allstate-codes-schema";
import { FormError, FormGrid } from "@/components/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";
import { useAppForm } from "@/hooks/form";
import { ApiError } from "@/lib/api-client";
import { serverFieldError } from "@/lib/server-field-error";
import {
  agencyUserOptionsKey,
  updateUserDetails,
  type AgencyUser,
  type UpdateUserDetailsInput,
} from "@/lib/users-api";

/**
 * Names optional, as on the profile page rather than the invite form: a
 * migrated user may have no split name, and the owner opening this to fix a
 * Bind ID should not have to invent one first. An emptied input clears.
 */
const editUserDetailsSchema = z.object({
  firstName: z.string().trim().max(100, "Keep it under 100 characters"),
  lastName: z.string().trim().max(100, "Keep it under 100 characters"),
  ...allstateCodesShape,
});

type EditUserDetailsValues = z.infer<typeof editUserDetailsSchema>;

function initialValues(user: AgencyUser): EditUserDetailsValues {
  return {
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    ...allstateCodesFormValues(user),
  };
}

/** Every key sent; blank → `null`, which the `clearable` PATCH reads as "clear". */
function toUpdateUserDetailsInput(
  values: EditUserDetailsValues,
): UpdateUserDetailsInput {
  return {
    firstName: values.firstName.trim() || null,
    lastName: values.lastName.trim() || null,
    ...allstateCodesForUpdate(values),
  };
}

interface EditUserDetailsDialogProps {
  user: AgencyUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The owner correcting someone's name or Allstate codes (PAC-173), through
 * `PATCH /users/:userId/details`.
 *
 * The codes are entered at the invite and by the employee when they accept,
 * and the employee can change their own on the profile page — this is the
 * owner's way to fix them for anyone, including a person who never accepted
 * or has since left (an old sale keeps its binder, so a removed user's Bind
 * ID still matters to Dash Reconciliation).
 *
 * A code another user already holds is a `409` naming them; it lands under the
 * input it concerns. Modelled on `ChangeRoleDialog`: a sibling of the row
 * menu, re-seeded each time it opens.
 */
export function EditUserDetailsDialog({
  user,
  open,
  onOpenChange,
}: EditUserDetailsDialogProps) {
  const queryClient = useQueryClient();
  const { user: currentUser, refreshUser } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isSelf = currentUser?.id === user._id;

  const save = useMutation({
    mutationFn: (input: UpdateUserDetailsInput) =>
      updateUserDetails(user._id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      // Pickers show the name too.
      await queryClient.invalidateQueries({ queryKey: agencyUserOptionsKey });
      // Your own name is in the sidebar chip and your codes on your profile,
      // both of which render from the session rather than this list.
      if (isSelf) await refreshUser();
      toast.success("Details updated");
      onOpenChange(false);
    },
    onError: (error) => {
      const conflict = allstateCodeConflict(error);
      if (conflict) {
        form.setFieldMeta(conflict.field, serverFieldError(conflict.message));
        return;
      }
      setSubmitError(
        error instanceof ApiError
          ? error.message
          : "Could not update this user's details.",
      );
    },
  });

  const form = useAppForm({
    defaultValues: initialValues(user),
    validators: { onBlur: editUserDetailsSchema },
    onSubmit: ({ value }) => {
      setSubmitError(null);
      save.mutate(toUpdateUserDetailsInput(value));
    },
  });

  // Re-seed each time it opens: the dialog stays mounted between openings, so
  // without this a cancelled edit would still be showing next time. Keyed on
  // `open` alone — a list refetch while it is open must not wipe the edit.
  useEffect(() => {
    if (!open) return;
    form.reset(initialValues(user));
    setSubmitError(null);
    save.reset();
    // `form` is a stable instance held in useState by the library.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
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

            <AllstateCodeFields
              form={form}
              fields={{
                allstateBindId: "allstateBindId",
                allstateSubProducerCode: "allstateSubProducerCode",
              }}
              inputClassName="bg-card border-border"
              columns={1}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={save.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="size-4 animate-spin" />}
                Save details
              </Button>
            </DialogFooter>
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
