import { HOUSEHOLD_MEMBER_ROLES } from "@sfa/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { z } from "zod";
import { FormGrid } from "@/components/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppForm } from "@/hooks/form";
import { addHouseholdMember } from "@/lib/households-api";

/**
 * The same four fields the New Lead form's member rows collect
 * (`HouseholdMembersField`), and the same `HOUSEHOLD_MEMBER_ROLES` vocabulary —
 * the two entry points write the same `roleInHousehold` values because they
 * read the same constant.
 *
 * Date of birth is optional, as it is on intake: a producer adding a child to a
 * household often does not have it, and refusing the member over it just means
 * the member never gets recorded.
 */
const memberSchema = z.object({
  firstName: z.string().trim().min(1, "Required").max(60, "Too long"),
  lastName: z.string().trim().min(1, "Required").max(60, "Too long"),
  dateOfBirth: z
    .union([
      z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
        // A birth date in the future is always a typo. Same rule as the intake
        // form, where it also protects contact matching.
        .refine((value) => value <= new Date().toISOString().slice(0, 10), {
          message: "Date of birth can't be in the future",
        }),
      z.literal(""),
    ])
    .optional(),
  role: z.enum(HOUSEHOLD_MEMBER_ROLES),
});

type MemberFormValues = z.infer<typeof memberSchema>;

const EMPTY: MemberFormValues = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  role: "Spouse",
};

/**
 * "+ Member" on the Household page: add a spouse, child, driver, or additional
 * named insured to the household on screen.
 *
 * `Named Insured` is deliberately absent from the picker. That role belongs to
 * the household's primary contact — it is implied by `contacts.isPrimary` and
 * stamped by intake — so offering it here would produce a second primary.
 */
export function AddMemberDialog({
  householdId,
  householdName,
  open,
  onOpenChange,
}: {
  householdId: string;
  householdName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (values: MemberFormValues) =>
      addHouseholdMember(householdId, {
        firstName: values.firstName,
        lastName: values.lastName,
        // Omitted rather than sent empty: the API takes `YYYY-MM-DD` or nothing.
        dateOfBirth: values.dateOfBirth || undefined,
        role: values.role,
      }),
    onSuccess: () => {
      // The member list lives on the household record, so refetch it — the
      // response alone would not update the profile column.
      queryClient.invalidateQueries({ queryKey: ["household", householdId] });
      onOpenChange(false);
    },
  });

  const form = useAppForm({
    defaultValues: EMPTY,
    validators: { onBlur: memberSchema },
    onSubmit: ({ value }) => {
      mutation.mutate(value);
    },
  });

  // Clear on open so a cancelled entry never resurfaces in the next one.
  // `form` is a stable instance, so it does not need to be a dependency.
  useEffect(() => {
    if (open) form.reset(EMPTY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add household member</DialogTitle>
          <DialogDescription>
            A new member of {householdName}. Only the primary contact carries
            contact details — those can be filled in afterwards.
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
            <FormGrid>
              <form.AppField name="firstName">
                {(f) => (
                  <f.TextField
                    label="First name"
                    inputClassName="bg-card border-border"
                  />
                )}
              </form.AppField>
              <form.AppField name="lastName">
                {(f) => (
                  <f.TextField
                    label="Last name"
                    inputClassName="bg-card border-border"
                  />
                )}
              </form.AppField>
              <form.AppField name="dateOfBirth">
                {(f) => (
                  <f.TextField
                    label="Date of birth"
                    type="date"
                    inputClassName="bg-card border-border"
                  />
                )}
              </form.AppField>
              <form.AppField name="role">
                {(f) => (
                  <f.SelectField
                    label="Relationship"
                    options={HOUSEHOLD_MEMBER_ROLES}
                    triggerClassName="w-full bg-card border-border"
                  />
                )}
              </form.AppField>
            </FormGrid>

            {mutation.isError && (
              <p role="alert" className="text-xs text-destructive">
                {mutation.error instanceof Error
                  ? mutation.error.message
                  : "Could not add the member."}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                Add member
              </Button>
            </DialogFooter>
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
