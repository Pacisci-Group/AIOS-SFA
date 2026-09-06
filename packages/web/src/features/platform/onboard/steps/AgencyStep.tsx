import { useStore } from "@tanstack/react-form";
import { useRef } from "react";
import { FormGrid, FormSection } from "@/components/form";
import { withForm } from "@/hooks/form";
import { EMPTY_ONBOARD, suggestSlug } from "../onboard-schema";
import { AvailabilityHint } from "./AvailabilityHint";
import { useAvailability } from "./useAvailability";

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

          <form.AppField name="agency.allstateAgencyId">
            {(f) => (
              <f.TextField
                label="Allstate agency ID (optional)"
                description="Checked against an uploaded mailer file's agencyid column."
                placeholder="A0B9049"
                autoComplete="off"
                inputClassName="bg-card border-border font-mono uppercase"
              />
            )}
          </form.AppField>
        </FormGrid>

        <p className="text-xs text-muted-foreground">
          Both mailer fields can be added later, but an agency without them
          imports no mailers and warns on every mailer upload.
        </p>
      </FormSection>
    );
  },
});
