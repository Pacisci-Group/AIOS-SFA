import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { AgencyPermission, type AgencyProfileView } from "@sfa/shared";
import { DetailCard } from "@/components/common/DetailCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppForm } from "@/hooks/form";
import { usePermissions } from "@/hooks/usePermissions";
import {
  agencyProfileKey,
  getAgencyProfile,
  updateAgencyProfile,
} from "@/lib/agency-profile-api";
import { ApiError } from "@/lib/api-client";
import { timeZoneLabel, timeZoneOptions } from "@/lib/time-zones";
import { SettingsPage } from "./SettingsPage";

/**
 * Workspace Settings → Agency (PAC-141): the agency's own time zone.
 *
 * Gated on `agency:branding:read`, with the save hidden without `:write` — the
 * same pair the API reuses for `/agency/profile`, for the reason given on
 * `AgencyProfileController`. By default that is the owner alone.
 *
 * Built on `useAppForm` like `CarrierAppointmentsEditor`, and split the same
 * way: the form mounts only once the stored value is in hand, and a save
 * re-seeds it by remount rather than `reset` (the array-field trap in
 * `docs/tanstack-form-spike-findings.md` does not bite a single select, but
 * one idiom for every settings form is worth more than the shortcut).
 */
export default function AgencyProfilePage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: agencyProfileKey,
    queryFn: getAgencyProfile,
  });
  const [seed, setSeed] = useState(0);

  const save = useMutation({
    mutationFn: (values: ProfileFormValues) =>
      updateAgencyProfile({ timezone: values.timezone }),
    onSuccess: (next) => {
      queryClient.setQueryData<AgencyProfileView>(agencyProfileKey, next);
      setSeed((previous) => previous + 1);
      toast.success(`Time zone set to ${timeZoneLabel(next.timezone)}.`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <SettingsPage
      title="Agency"
      caption="The clock your working day is kept on"
      icon={Clock}
    >
      <DetailCard
        title="Time zone"
        subheading="Dashboard date windows, business-day aging and the 8 PM end-of-day run all follow it."
      >
        {query.isPending ? (
          <Skeleton className="h-28 w-full rounded-xl" />
        ) : query.isError ? (
          <p className="text-sm text-destructive">
            {errorMessage(query.error)}
          </p>
        ) : (
          <ProfileForm
            key={seed}
            initial={{ timezone: query.data.timezone }}
            canWrite={can(AgencyPermission.BrandingWrite)}
            saving={save.isPending}
            onSubmit={(values) => save.mutate(values)}
          />
        )}
      </DetailCard>
    </SettingsPage>
  );
}

const profileFormSchema = z.object({
  timezone: z.string().trim().min(1, "Choose a time zone"),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

function ProfileForm({
  initial,
  canWrite,
  saving,
  onSubmit,
}: {
  initial: ProfileFormValues;
  canWrite: boolean;
  saving: boolean;
  onSubmit: (values: ProfileFormValues) => void;
}) {
  const [defaultValues] = useState(initial);
  // Includes the stored value even when this browser's `Intl` lacks it.
  const options = useMemo(
    () => timeZoneOptions(initial.timezone),
    [initial.timezone],
  );

  const form = useAppForm({
    defaultValues,
    validators: { onBlur: profileFormSchema },
    onSubmit: ({ value }) => onSubmit(value),
  });

  return (
    <form.AppForm>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
        className="space-y-4"
      >
        <form.AppField name="timezone">
          {(f) => (
            <f.ComboboxField
              label="Time zone"
              options={options}
              disabled={!canWrite}
              searchPlaceholder="Search by city or zone…"
              emptyText="No zone matches."
            />
          )}
        </form.AppField>

        <p className="text-xs text-muted-foreground">
          Changing it moves today's and every future date window. Sales and
          quotes already filed keep the day they were filed on, and the
          end-of-day Away run follows the new clock from its next 8 PM.
        </p>

        {canWrite && (
          <form.Subscribe selector={(state) => state.isDirty}>
            {(isDirty) => (
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={saving || !isDirty}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            )}
          </form.Subscribe>
        )}
      </form>
    </form.AppForm>
  );
}

/**
 * The API's zod and Mongo-probe failures both arrive as
 * `{ message: 'Validation failed', errors: { fieldErrors: { timezone: [...] } } }`;
 * the field message is the one worth showing.
 */
function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as
      | { errors?: { fieldErrors?: Record<string, string[]> } }
      | undefined;
    const field = body?.errors?.fieldErrors?.timezone?.[0];
    if (field) return field;
    return err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
