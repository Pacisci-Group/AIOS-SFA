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
import { END_OF_DAY_HOUR_OPTIONS } from "@/lib/end-of-day-hour";
import { timeZoneOptions } from "@/lib/time-zones";
import { SettingsPage } from "./SettingsPage";

/**
 * Workspace Settings → Agency: the agency's working day — its time zone
 * (PAC-141) and the hour everyone is set Away (PAC-149).
 *
 * Gated on `agency:settings:read`, with the save hidden without `:write` — the
 * pair the API gates `/agency/profile` on, for the reason given on
 * `AgencyProfileController`. By default that is the owner alone.
 *
 * Label, control and Save — no explanatory copy under the fields; the lines
 * PAC-141 shipped there read as more confusing than the fields themselves.
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
    // Both fields every time: the API compares each with what it holds and
    // touches the Away marker only for one that actually changed.
    mutationFn: (values: ProfileFormValues) =>
      updateAgencyProfile({
        timezone: values.timezone,
        endOfDayHour: Number(values.endOfDayHour),
      }),
    onSuccess: (next) => {
      queryClient.setQueryData<AgencyProfileView>(agencyProfileKey, next);
      setSeed((previous) => previous + 1);
      toast.success("Agency settings saved.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <SettingsPage
      title="Agency"
      caption="The clock your working day is kept on"
      icon={Clock}
    >
      <DetailCard title="Working day">
        {query.isPending ? (
          <Skeleton className="h-28 w-full rounded-xl" />
        ) : query.isError ? (
          <p className="text-sm text-destructive">
            {errorMessage(query.error)}
          </p>
        ) : (
          <ProfileForm
            key={seed}
            initial={{
              timezone: query.data.timezone,
              endOfDayHour: String(query.data.endOfDayHour),
            }}
            canWrite={can(AgencyPermission.SettingsWrite)}
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
  // A string because `SelectField`'s values are; one of the 24 options.
  endOfDayHour: z.string().regex(/^(1?\d|2[0-3])$/, "Choose an hour"),
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

        <form.AppField name="endOfDayHour">
          {(f) => (
            <f.SelectField
              label="Set everyone Away at"
              options={END_OF_DAY_HOUR_OPTIONS}
              disabled={!canWrite}
              triggerClassName="w-full bg-card border-border"
              contentClassName="max-h-72"
            />
          )}
        </form.AppField>

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
 * `{ message: 'Validation failed', errors: { fieldErrors: { timezone: [...] } } }`
 * — or `endOfDayHour`, or a form-level error when neither field was sent; the
 * field message is the one worth showing.
 */
function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as
      | {
          errors?: {
            fieldErrors?: Record<string, string[]>;
            formErrors?: string[];
          };
        }
      | undefined;
    const errors = body?.errors;
    const field =
      errors?.fieldErrors?.timezone?.[0] ??
      errors?.fieldErrors?.endOfDayHour?.[0] ??
      errors?.formErrors?.[0];
    if (field) return field;
    return err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
