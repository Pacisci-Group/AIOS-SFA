import { useStore } from "@tanstack/react-form";
import { FormGrid, FormSection } from "@/components/form";
import { withForm } from "@/hooks/form";
import { EMPTY_ONBOARD } from "../onboard-schema";
import { AvailabilityHint } from "./AvailabilityHint";
import { useAvailability } from "./useAvailability";

/**
 * Step 4 — the agency's first account.
 *
 * They are created as a pending invite holding the Agency Owner role, and are
 * emailed a link to set a password. Nobody here ever types their password, and
 * no credential is shared.
 */
export const OwnerStep = withForm({
  defaultValues: EMPTY_ONBOARD,
  render: function Render({ form }) {
    const email = useStore(form.store, (s) => s.values.owner.email);
    const emailAvailable = useAvailability("email", email);

    return (
      <FormSection
        title="Agency owner"
        description="They receive an email to set their own password and finish setting up the agency."
      >
        <FormGrid>
          <form.AppField name="owner.firstName">
            {(f) => (
              <f.TextField
                label="First name"
                autoComplete="off"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="owner.lastName">
            {(f) => (
              <f.TextField
                label="Last name"
                autoComplete="off"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="owner.email">
            {(f) => (
              <div className="sm:col-span-2 space-y-1.5">
                <f.TextField
                  label="Email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  inputClassName="bg-card border-border"
                />
                <AvailabilityHint
                  available={emailAvailable}
                  freeLabel="That address is free."
                  /* Platform-wide: `User.email` is unique across every tenant,
                     so the address may belong to a different agency entirely. */
                  takenLabel="That address already belongs to an account on the platform."
                />
              </div>
            )}
          </form.AppField>
        </FormGrid>
      </FormSection>
    );
  },
});
