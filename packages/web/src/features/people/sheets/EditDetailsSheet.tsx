import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PersonProfileView } from "@sfa/shared";
import { FormError, FormGrid } from "@/components/form";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { useAppForm } from "@/hooks/form";
import { ApiError } from "@/lib/api-client";
import { agencyTodayYmd } from "@/lib/dates";
import { peopleKeys, updatePersonFacts } from "@/lib/people-api";
import { PersonSheet } from "./PersonSheet";
import {
  detailsFormSchema,
  detailsFromProfile,
  toFactsInput,
  type DetailsFormValues,
} from "./person-forms";

/**
 * Edit a person's details (PAC-162, `agency:hr:admin`): name halves, phone,
 * hire date, date of birth, show-birthday. Sends only what changed; the
 * server's 400 (a future hire date, clearing an active employee's) renders
 * as the form error. Remounted by the caller per opening, so the form
 * seeds fresh from the profile each time.
 */
export function EditDetailsSheet({
  profile,
  onClose,
}: {
  profile: PersonProfileView;
  onClose: () => void;
}) {
  const { user: viewer } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const today = agencyTodayYmd(viewer?.timeZone);
  const original = detailsFromProfile(profile);
  const active = profile.employment.status === "active";

  const save = useMutation({
    mutationFn: (values: DetailsFormValues) =>
      updatePersonFacts(profile.user.id, toFactsInput(values, original)),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: peopleKeys.profile(profile.user.id) }),
        queryClient.invalidateQueries({ queryKey: ["users"] }),
      ]);
      toast.success("Details saved.");
      onClose();
    },
    onError: (failure) =>
      setError(failure instanceof ApiError ? failure.message : "Could not save. Try again."),
  });

  const form = useAppForm({
    defaultValues: original,
    validators: { onBlur: detailsFormSchema(today) },
    onSubmit: ({ value }) => {
      setError(null);
      if (Object.keys(toFactsInput(value, original)).length === 0) {
        onClose();
        return;
      }
      save.mutate(value);
    },
  });

  return (
    <PersonSheet eyebrow={profile.user.name} title="Edit details" onClose={onClose}>
      <form.AppForm>
        <form
          className="flex flex-1 flex-col gap-5 px-6 py-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FormGrid>
            <form.AppField name="firstName">
              {(f) => <f.TextField label="First name" autoComplete="off" />}
            </form.AppField>
            <form.AppField name="lastName">
              {(f) => <f.TextField label="Last name" autoComplete="off" />}
            </form.AppField>
            <form.AppField name="phone">
              {(f) => (
                <f.TextField label="Phone" type="tel" placeholder="(312) 555-0100" />
              )}
            </form.AppField>
            <form.AppField name="hireDate">
              {(f) => (
                <f.TextField
                  label="Hire date"
                  type="date"
                  max={today}
                  description={
                    active
                      ? "An active employee always has one."
                      : "Set by Complete onboarding, or here."
                  }
                />
              )}
            </form.AppField>
            <form.AppField name="dateOfBirth">
              {(f) => (
                <f.TextField
                  label="Date of birth"
                  type="date"
                  max={today}
                  description="Seen by HR admins and the person; never shown as an age."
                />
              )}
            </form.AppField>
          </FormGrid>
          <form.AppField name="showBirthday">
            {(f) => (
              <f.SwitchField
                label="Show birthday on the calendar"
                hint="Month and day only, on the agency calendar."
              />
            )}
          </form.AppField>

          <FormError>{error}</FormError>

          <div className="mt-auto flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </form.AppForm>
    </PersonSheet>
  );
}
