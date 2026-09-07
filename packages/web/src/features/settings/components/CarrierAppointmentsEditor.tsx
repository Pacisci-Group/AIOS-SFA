import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import type {
  CarrierAppointmentsResponse,
  CarrierAppointmentView,
  CarrierOption,
} from "@sfa/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppForm } from "@/hooks/form";
import { ApiError } from "@/lib/api-client";
import {
  agencyCarrierAppointmentsKey,
  getCarrierAppointments,
  replaceCarrierAppointments,
} from "@/lib/agency-carrier-appointments-api";
import {
  CarrierAppointmentRowGroup,
  CarrierAppointmentsShell,
  defaultCarrierId,
  emptyAppointment,
} from "./carrier-appointment-fields";

/**
 * The agency's own carrier appointments, editable (PAC-93).
 *
 * Rendered by both `/settings/carriers` and the owner's first-run setup step,
 * which is the whole reason it is a component rather than a page: the two must
 * not become two editors with two ideas of what a valid appointment is.
 *
 * ## Why `useAppForm` when the sibling settings pages use plain `useState`
 *
 * `BrandingPage` and `EmailSenderPage` predate the form idiom AGENTS.md §11
 * mandates; `ProfilePage` (the newest of them) already follows it. This one has
 * a repeating array with cross-row rules, and the row component it shares with
 * the onboarding wizard *is* a TanStack Form field group — reimplementing it on
 * `useState` would fork that component in two.
 */

const appointmentsFormSchema = z.object({
  appointments: z.array(
    z.object({
      carrierId: z.string().trim().min(1, "Choose a carrier"),
      // No `min(1)`: a blank code is how the owner leaves a row for later, and
      // the server drops it rather than rejecting the save.
      carrierAgencyCode: z.string().trim().max(40),
      isPrimary: z.boolean().optional(),
      active: z.boolean().optional(),
    }),
  ),
});

type AppointmentsFormValues = z.infer<typeof appointmentsFormSchema>;

function toFormValues(
  appointments: readonly CarrierAppointmentView[],
): AppointmentsFormValues {
  return {
    appointments: appointments.map((row) => ({
      carrierId: row.carrierId,
      carrierAgencyCode: row.carrierAgencyCode,
      isPrimary: row.isPrimary,
      active: row.active,
    })),
  };
}

interface CarrierAppointmentsEditorProps {
  /** Gates the write controls. The API is the enforcement; this is the UI. */
  canWrite: boolean;
  /** Copy for the "nothing here yet" state, which differs per surface. */
  emptyMessage?: React.ReactNode;
  /** Label on the save button — "Save" in settings, "Continue" in the wizard. */
  saveLabel?: string;
  /** Runs after a successful save. The setup step advances on it. */
  onSaved?: () => void;
}

export function CarrierAppointmentsEditor({
  canWrite,
  emptyMessage,
  saveLabel = "Save",
  onSaved,
}: CarrierAppointmentsEditorProps) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: agencyCarrierAppointmentsKey,
    queryFn: getCarrierAppointments,
  });

  /*
   * Bumped to re-seed the form from the server, by remounting it. Only a save
   * does that — a background refetch must never rewrite rows under someone
   * mid-edit, and with the form mounted from its own values there is no reset
   * to guard against one.
   */
  const [seed, setSeed] = useState(0);

  const save = useMutation({
    mutationFn: (values: AppointmentsFormValues) =>
      replaceCarrierAppointments(
        values.appointments.map((row) => ({
          carrierId: row.carrierId,
          carrierAgencyCode: row.carrierAgencyCode.trim() || undefined,
          isPrimary: row.isPrimary,
          active: row.active,
        })),
      ),
    onSuccess: (appointments) => {
      // The endpoint returns the whole list, so write it in rather than
      // invalidating — and keep the carrier options, which the PUT does not
      // return.
      queryClient.setQueryData<CarrierAppointmentsResponse>(
        agencyCarrierAppointmentsKey,
        (previous) => ({
          appointments,
          carrierOptions: previous?.carrierOptions ?? [],
        }),
      );
      // Re-seed from what was actually stored: code-less rows are dropped
      // server-side and the primary flag can move, so the form would otherwise
      // keep showing rows that no longer exist.
      setSeed((previous) => previous + 1);
      toast.success("Carrier appointments saved.");
      onSaved?.();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (query.isPending) return <Skeleton className="h-48 w-full rounded-xl" />;
  if (query.isError) {
    return (
      <p className="text-sm text-destructive">{errorMessage(query.error)}</p>
    );
  }

  return (
    <AppointmentsForm
      key={seed}
      initial={toFormValues(query.data.appointments)}
      carriers={query.data.carrierOptions}
      canWrite={canWrite}
      emptyMessage={emptyMessage}
      saveLabel={saveLabel}
      saving={save.isPending}
      onSubmit={(values) => save.mutate(values)}
    />
  );
}

interface AppointmentsFormProps {
  initial: AppointmentsFormValues;
  carriers: readonly CarrierOption[];
  canWrite: boolean;
  emptyMessage?: React.ReactNode;
  saveLabel: string;
  saving: boolean;
  onSubmit: (values: AppointmentsFormValues) => void;
}

/**
 * Load the appointments, *then* build the form from them.
 *
 * ⚠ Two components rather than one, and the split is load-bearing — the same
 * one `RunCampaignPage`'s `SetupStep` makes, for the same reason. Seeding a
 * mounted form with `form.reset(...)` does reach the form's state, but a
 * `mode="array"` field subscribes to nothing except its own array version, and
 * `reset` zeroes that version instead of bumping it. The rows land in state and
 * are never drawn: the page reads "No carrier appointments yet" over an agency
 * that has one, and the next "Add appointment" reveals the hidden row beside
 * the new one. Mounting the form only once its real values exist makes the
 * ordering impossible to get wrong.
 *
 * `defaultValues` is therefore frozen at mount rather than tracked: it is the
 * changing identity of that object, on a form nobody has touched yet, that
 * makes `FormApi.update` rewrite values behind the same blind array field.
 * Re-seeding is a remount (`key`), never a new prop.
 */
function AppointmentsForm({
  initial,
  carriers,
  canWrite,
  emptyMessage,
  saveLabel,
  saving,
  onSubmit,
}: AppointmentsFormProps) {
  const [defaultValues] = useState(initial);

  const form = useAppForm({
    defaultValues,
    validators: { onBlur: appointmentsFormSchema },
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
        <form.Field name="appointments" mode="array">
          {(field) => (
            <CarrierAppointmentsShell
              count={field.state.value.length}
              disabled={!canWrite}
              emptyMessage={emptyMessage}
              onAdd={() =>
                field.pushValue({
                  ...emptyAppointment(),
                  carrierId: defaultCarrierId(carriers) ?? "",
                  // The first appointment an agency holds is its primary; after
                  // that the operator chooses.
                  isPrimary: field.state.value.length === 0,
                })
              }
            >
              {field.state.value.map((_, index) => (
                <CarrierAppointmentRowGroup
                  key={index}
                  form={form}
                  fields={`appointments[${index}]`}
                  index={index}
                  carriers={carriers}
                  showState
                  disabled={!canWrite}
                  onPrimaryChosen={() => {
                    // Exactly one primary. The server enforces it too and would
                    // 400, but silently un-checking the others is what someone
                    // ticking a second box means.
                    field.state.value.forEach((_row, other) => {
                      if (other === index) return;
                      form.setFieldValue(
                        `appointments[${other}].isPrimary`,
                        false,
                      );
                    });
                  }}
                  onRemove={() => {
                    field.removeValue(index);
                    // Removing a row fires no blur, so the array's rules would
                    // not re-run until something else was touched.
                    field.handleBlur();
                  }}
                />
              ))}
            </CarrierAppointmentsShell>
          )}
        </form.Field>

        <p className="text-xs text-muted-foreground">
          A code identifies you to one carrier only, so the same code can be
          held by different agencies under different carriers. Removing an
          appointment releases its code; deactivating one does not.
        </p>

        {canWrite && (
          <Button type="submit" variant="outline" size="sm" disabled={saving}>
            {saving ? "Saving…" : saveLabel}
          </Button>
        )}
      </form>
    </form.AppForm>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError || err instanceof Error
    ? err.message
    : "Something went wrong.";
}
