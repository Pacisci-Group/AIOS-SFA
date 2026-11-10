import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-form";
import { useEffect, useRef } from "react";
import { FormGrid, FormSection } from "@/components/form";
import { withForm } from "@/hooks/form";
import {
  getPlatformCarriers,
  platformCarriersKey,
} from "@/lib/carriers-api";
import {
  CarrierAppointmentRowGroup,
  CarrierAppointmentsShell,
  defaultCarrierId,
  emptyAppointment,
} from "@/features/settings/components/carrier-appointment-fields";
import { EMPTY_ONBOARD, suggestSlug } from "../onboard-schema";
import { AvailabilityHint } from "./AvailabilityHint";
import { useAppointmentAvailability, useAvailability } from "./useAvailability";

/**
 * Step 1 — who the tenant is.
 *
 * The slug follows the name until the operator touches it, then stops. Silently
 * overwriting a deliberate slug on the next keystroke of the name is the kind of
 * thing that is maddening to use and almost impossible to report.
 */
export const AgencyStep = withForm({
  defaultValues: EMPTY_ONBOARD,
  render: function Render({ form }) {
    // A ref, not state: it must not trigger a render, and it is read inside an
    // event handler rather than during one.
    const slugEdited = useRef(false);

    const slug = useStore(form.store, (s) => s.values.agency.slug);
    const ticker = useStore(form.store, (s) => s.values.agency.ticker);
    const slugAvailable = useAvailability("slug", slug);
    const tickerAvailable = useAvailability("ticker", ticker);

    // Globals only, and reachable without an agency — see `getPlatformCarriers`.
    const { data: carriers = [] } = useQuery({
      queryKey: platformCarriersKey,
      queryFn: getPlatformCarriers,
      staleTime: Infinity,
    });

    /*
     * Preselect Allstate on a row the operator has not chosen for yet — the
     * overwhelmingly common case. Guarded on the value still being empty so it
     * can never overwrite a deliberate choice, the same rule the slug
     * suggestion above follows.
     */
    const appointments = useStore(
      form.store,
      (s) => s.values.agency.carrierAppointments,
    );
    useEffect(() => {
      const fallback = defaultCarrierId(carriers);
      if (!fallback) return;
      appointments.forEach((row, index) => {
        if (row.carrierId) return;
        form.setFieldValue(
          `agency.carrierAppointments[${index}].carrierId`,
          fallback,
        );
      });
    }, [carriers, appointments, form]);

    return (
      <FormSection title="Agency">
        <FormGrid>
          <form.AppField name="agency.name">
            {(f) => (
              <f.TextField
                label="Agency name"
                placeholder="Acme Insurance"
                autoComplete="off"
                className="sm:col-span-2"
                inputClassName="bg-card border-border"
                onBlur={() => {
                  if (slugEdited.current) return;
                  const suggested = suggestSlug(f.state.value);
                  if (suggested) {
                    form.setFieldValue("agency.slug", suggested);
                    // A programmatic write fires no blur, so the slug's own
                    // rules would not run until it was touched by hand.
                    void form.validateField("agency.slug", "blur");
                  }
                }}
              />
            )}
          </form.AppField>

          <form.AppField name="agency.slug">
            {(f) => (
              <div className="sm:col-span-2 space-y-1.5">
                <f.TextField
                  label="Slug"
                  description="Used in links and, later, as their subdomain. Lowercase letters, numbers and hyphens."
                  placeholder="acme-insurance"
                  autoComplete="off"
                  inputClassName="bg-card border-border font-mono"
                  onBlur={() => {
                    slugEdited.current = true;
                  }}
                />
                <AvailabilityHint
                  available={slugAvailable}
                  freeLabel="That slug is available."
                  takenLabel="Another agency already uses that slug."
                />
              </div>
            )}
          </form.AppField>

          <form.AppField name="agency.ticker">
            {(f) => (
              <div className="space-y-1.5">
                <f.TextField
                  label="Mailer ticker (optional)"
                  description="Three letters prefixing their mailer filenames — SFA in SFA-20P."
                  placeholder="ACM"
                  autoComplete="off"
                  inputClassName="bg-card border-border font-mono uppercase"
                />
                <AvailabilityHint
                  available={tickerAvailable}
                  freeLabel="That ticker is available."
                  takenLabel="Another agency already uses that ticker."
                />
              </div>
            )}
          </form.AppField>

          <form.AppField name="agency.npn">
            {(f) => (
              <f.TextField
                label="NPN (optional)"
                description="National Producer Number — the agency's carrier-independent id."
                placeholder="1234567"
                autoComplete="off"
                inputClassName="bg-card border-border font-mono"
              />
            )}
          </form.AppField>
        </FormGrid>

        <FormSection
          title="Carrier appointments"
          titleAs="h3"
          description="Which carriers appointed this agency, and the code each one issued."
        >
          <form.Field name="agency.carrierAppointments" mode="array">
            {(field) => (
              <CarrierAppointmentsShell
                count={field.state.value.length}
                onAdd={() =>
                  field.pushValue({
                    ...emptyAppointment(),
                    carrierId: defaultCarrierId(carriers) ?? "",
                  })
                }
              >
                {field.state.value.map((_, index) => (
                  <div key={index} className="space-y-1.5">
                    <CarrierAppointmentRowGroup
                      form={form}
                      fields={`agency.carrierAppointments[${index}]`}
                      index={index}
                      carriers={carriers}
                      /*
                       * `isPrimary` and `active` are hidden here on purpose.
                       * The wizard collects an agency's first appointments, so
                       * the primary is decided by construction, and there is
                       * nothing yet to deactivate. Both are editable in
                       * Workspace Settings.
                       */
                      showState={false}
                      onRemove={() => {
                        field.removeValue(index);
                        // Removing a row fires no blur, so the array's own
                        // rules would not re-run until something else was
                        // touched.
                        field.handleBlur();
                      }}
                    />
                    <AppointmentTakenHint form={form} index={index} />
                  </div>
                ))}
              </CarrierAppointmentsShell>
            )}
          </form.Field>
        </FormSection>

        <p className="text-xs text-muted-foreground">
          All of this can be added later — the owner is asked for anything left
          blank when they set the agency up, and it stays editable under
          Workspace Settings. But an agency with no ticker imports no mailers,
          and one with no appointment warns on every mailer upload.
        </p>
      </FormSection>
    );
  },
});

/**
 * "That code is already taken" for one appointment row.
 *
 * Its own component because the hook has to be called per row, and a hook
 * cannot be called inside the `.map` of a render prop. It subscribes to just
 * that row's two values, so a change on row 2 does not re-query row 1.
 */
function AppointmentTakenHint({
  form,
  index,
}: {
  form: Parameters<typeof AgencyStep>[0]["form"];
  index: number;
}) {
  const row = useStore(
    form.store,
    (s) => s.values.agency.carrierAppointments[index],
  );
  const available = useAppointmentAvailability(
    row?.carrierId ?? "",
    row?.carrierAgencyCode ?? "",
  );

  return (
    <AvailabilityHint
      available={available}
      freeLabel="That code is available under this carrier."
      takenLabel="Another agency already holds that code with this carrier."
    />
  );
}
