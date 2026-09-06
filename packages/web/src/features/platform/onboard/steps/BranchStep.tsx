import { AddressFields } from "@/components/address/AddressFields";
import { FormSection } from "@/components/form";
import { withForm } from "@/hooks/form";
import { EMPTY_ONBOARD } from "../onboard-schema";

/**
 * Step 2 — the first branch.
 *
 * Exactly one, deliberately: every user and every record needs a branch
 * (`TenantRecord.branchId` is required), so a tenant without one cannot hold
 * data. More branches belong to branch management, which is not built yet.
 *
 * The address is optional — nothing reads it yet, and blocking a tenant on a
 * detail the operator may not have to hand would be inventing a requirement.
 */
export const BranchStep = withForm({
  defaultValues: EMPTY_ONBOARD,
  render: function Render({ form }) {
    return (
      <FormSection
        title="First branch"
        description="Defaults to Main. Everyone at the agency starts here; more branches can be added later."
      >
        <form.AppField name="branch.name">
          {(f) => (
            <f.TextField
              label="Branch name"
              placeholder="Main"
              autoComplete="off"
              inputClassName="bg-card border-border"
            />
          )}
        </form.AppField>

        <AddressFields
          form={form}
          fields="branch.address"
          inputClassName="bg-card border-border"
        />
      </FormSection>
    );
  },
});
