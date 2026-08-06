import type { QuoteRecapLeadContext } from "@sfa/shared";
import { isPropertyPolicyType } from "@sfa/shared";
import { FormError, FormSection } from "@/components/form";
import { FieldShell, useFieldError } from "@/components/form/fields";
import {
  PolicyRowGroup,
  PolicyRowsShell,
} from "@/components/policies/PolicyRowsField";
import {
  PropertyAddressFields,
  PropertyAddressSection,
} from "@/components/policies/PropertyAddressSection";
import { Button } from "@/components/ui/button";
import { FileDropzone } from "@/components/upload/FileDropzone";
import { useAppForm } from "@/hooks/form";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/quote-recaps-api";
import { LeadContextHeader } from "./LeadContextHeader";
import {
  emptyQuoteRecap,
  parseQuoteRecap,
  quoteRecapSchema,
  type QuoteRecapFormValues,
} from "./quote-recap-schema";

interface QuoteRecapFormProps {
  context: QuoteRecapLeadContext;
  submitting: boolean;
  errorMessage: string | null;
  onSubmit: (values: QuoteRecapFormValues) => void;
}

const emptyRow = () => ({ policyType: "Auto" as const, premium: "", itemCount: "1" });

export function QuoteRecapForm({
  context,
  submitting,
  errorMessage,
  onSubmit,
}: QuoteRecapFormProps) {
  const form = useAppForm({
    // Default the toggle on only when there is actually an address to copy.
    // Otherwise the fields would be blank *and* disabled, the conditional
    // required rule would fire, and the producer would be stuck.
    defaultValues: emptyQuoteRecap(Boolean(context.householdAddress)),
    validators: { onBlur: quoteRecapSchema },
    // Validation has already passed here; the parse narrows the optional
    // `quoteDocument` of form state to the required one of the wire shape.
    onSubmit: ({ value }) => onSubmit(parseQuoteRecap(value)),
  });

  const blocked = !context.householdId;

  return (
    <form.AppForm>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="space-y-6"
        noValidate
      >
        <LeadContextHeader context={context} />

        <FormSection
          title="Quoted policies"
          description="One row per policy. The totals are calculated for you."
        >
          <form.Field name="policies" mode="array">
            {(field) => (
              <PolicyRowsShell
                count={field.state.value.length}
                onAdd={() => field.pushValue(emptyRow())}
              >
                {field.state.value.map((_, i) => (
                  <PolicyRowGroup
                    key={i}
                    form={form}
                    fields={`policies[${i}]`}
                    index={i}
                    columns={3}
                    onRemove={
                      field.state.value.length > 1
                        ? () => field.removeValue(i)
                        : undefined
                    }
                  >
                    {/* Quote-Recap-only: the New Lead form asks for policies of
                        interest before any quote exists, so it has no premium
                        to record. Composed in rather than flag-gated. */}
                    <form.AppField name={`policies[${i}].premium`}>
                      {(f) => (
                        <f.NumberField
                          label="Premium ($)"
                          step="0.01"
                          min="0"
                          inputClassName="bg-card border-border"
                        />
                      )}
                    </form.AppField>
                  </PolicyRowGroup>
                ))}
              </PolicyRowsShell>
            )}
          </form.Field>
        </FormSection>

        <form.Subscribe selector={(s) => s.values.policies}>
          {(policies) =>
            (policies ?? []).some((p) => isPropertyPolicyType(p?.policyType)) ? (
              <PropertyAddressSection>
                <PropertyAddressFields
                  form={form}
                  fields={{
                    sameAsHousehold: "sameAsHousehold",
                    propertyAddress: "propertyAddress",
                  }}
                  householdAddress={context.householdAddress}
                />
              </PropertyAddressSection>
            ) : null
          }
        </form.Subscribe>

        <FormSection title="Quote document" description="The carrier quote. Required.">
          <form.Field name="quoteDocument">
            {(field) => (
              <FieldShell error={useFieldError(field.state.meta)}>
                {() => (
                  <FileDropzone
                    accept={ALLOWED_UPLOAD_TYPES}
                    maxBytes={MAX_UPLOAD_BYTES}
                    file={field.state.value ?? null}
                    onSelect={(file) => {
                      field.handleChange(file ?? undefined);
                      field.handleBlur();
                    }}
                    hint="PDF, JPG, PNG up to 10MB"
                    disabled={submitting}
                    aria-label="Upload the quote document"
                  />
                )}
              </FieldShell>
            )}
          </form.Field>
        </FormSection>

        <FormSection title="Notes">
          <form.AppField name="notes">
            {(f) => (
              <f.TextareaField
                label="Notes"
                srOnlyLabel
                rows={4}
                placeholder="Anything the next person needs to know about this proposal."
                textareaClassName="bg-card border-border"
              />
            )}
          </form.AppField>
        </FormSection>

        <FormError>{errorMessage}</FormError>

        <Button
          type="submit"
          variant="brand"
          disabled={submitting || blocked}
          className="w-full sm:w-auto active:scale-95"
        >
          {submitting ? "Saving…" : "Record quote recap"}
        </Button>
      </form>
    </form.AppForm>
  );
}
