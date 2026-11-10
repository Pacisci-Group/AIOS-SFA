import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AgencyProfileView } from "@sfa/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppForm } from "@/hooks/form";
import {
  agencyProfileKey,
  getAgencyProfile,
  updateAgencyProfile,
} from "@/lib/agency-profile-api";
import { ApiError } from "@/lib/api-client";
import { timeZoneOptions } from "@/lib/time-zones";
import { useStepContinue } from "./AgencySetupSteps";

/**
 * The time-zone step of the owner's first-run setup (PAC-161, epic §1).
 *
 * Saves on select, with no Save button: the step is one question, and the
 * answer is written through the same `PATCH /agency/profile` the settings
 * page uses the moment it is chosen. Not skippable — the agency is created
 * on the platform default (US Central) and this is the one place the owner
 * is asked to confirm it. Continue is disabled while a save is in flight.
 * The end-of-day hour stays on the settings page; it has a sensible default.
 */
export function TimeZoneStep() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: agencyProfileKey,
    queryFn: getAgencyProfile,
  });

  const save = useMutation({
    mutationFn: (timezone: string) => updateAgencyProfile({ timezone }),
    onSuccess: (next) => {
      queryClient.setQueryData<AgencyProfileView>(agencyProfileKey, next);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  useStepContinue(null, save.isPending);

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 md:p-5">
      {query.isPending ? (
        <Skeleton className="h-16 w-full rounded-xl" />
      ) : query.isError ? (
        <p className="text-sm text-destructive">{errorMessage(query.error)}</p>
      ) : (
        <ZoneField
          stored={query.data.timezone}
          saving={save.isPending}
          onPick={(zone) => {
            if (zone !== query.data.timezone) save.mutate(zone);
          }}
        />
      )}
    </div>
  );
}

function ZoneField({
  stored,
  saving,
  onPick,
}: {
  stored: string;
  saving: boolean;
  onPick: (zone: string) => void;
}) {
  const [defaultValues] = useState({ timezone: stored });
  const options = useMemo(() => timeZoneOptions(stored), [stored]);
  const form = useAppForm({ defaultValues });

  return (
    <form.AppForm>
      <form.AppField name="timezone">
        {(f) => (
          <f.ComboboxField
            label="Time zone"
            description={
              saving
                ? "Saving…"
                : "Pre-set to US Central. Pick the zone your office keeps its hours in; it saves as soon as you choose."
            }
            options={options}
            disabled={saving}
            searchPlaceholder="Search by city or zone…"
            emptyText="No zone matches."
            triggerClassName="bg-card border-border"
            onChanged={onPick}
          />
        )}
      </form.AppField>
    </form.AppForm>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as
      | { errors?: { fieldErrors?: Record<string, string[]> } }
      | undefined;
    return body?.errors?.fieldErrors?.timezone?.[0] ?? err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
