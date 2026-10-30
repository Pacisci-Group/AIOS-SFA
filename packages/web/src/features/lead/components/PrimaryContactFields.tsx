import { FormGrid } from "@/components/form";
import { withFieldGroup } from "@/hooks/form";

/**
 * Annotated, as `HouseholdMembersField`'s defaults are: a group's shape has to
 * match the parent's exactly or the field path won't resolve. All five are
 * required strings on the primary contact — DOB, phone and email included.
 */
const primaryContactDefaults: {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
  email: string;
} = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  phone: "",
  email: "",
};

/**
 * The household's primary contact — who the lead or the client is.
 *
 * Lifted out of `LeadIntakeForm` when a second form needed it: the 1-800
 * service intake (PAC-173 PR 5) captures a household exactly as a lead does,
 * without the lead.
 */
export const PrimaryContactFields = withFieldGroup({
  defaultValues: primaryContactDefaults,
  render: function Render({ group }) {
    return (
      <FormGrid>
        <group.AppField name="firstName">
          {(f) => (
            <f.TextField
              label="First name"
              autoComplete="given-name"
              inputClassName="bg-card border-border"
            />
          )}
        </group.AppField>
        <group.AppField name="lastName">
          {(f) => (
            <f.TextField
              label="Last name"
              autoComplete="family-name"
              inputClassName="bg-card border-border"
            />
          )}
        </group.AppField>
        <group.AppField name="dateOfBirth">
          {(f) => (
            <f.TextField
              label="Date of birth"
              type="date"
              inputClassName="bg-card border-border"
            />
          )}
        </group.AppField>
        <group.AppField name="phone">
          {(f) => (
            <f.TextField
              label="Phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(555) 123-4567"
              inputClassName="bg-card border-border"
            />
          )}
        </group.AppField>
        <group.AppField name="email">
          {(f) => (
            <f.TextField
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              className="sm:col-span-2"
              inputClassName="bg-card border-border"
            />
          )}
        </group.AppField>
      </FormGrid>
    );
  },
});
