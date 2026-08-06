import { zodResolver } from "@hookform/resolvers/zod";
import type { QuoteRecapLeadContext } from "@sfa/shared";
import { isPropertyPolicyType } from "@sfa/shared";
import { useForm, useWatch } from "react-hook-form";
import { FormError, FormSection } from "@/components/form";
import { PolicyRowsField } from "@/components/policies/PolicyRowsField";
import { PropertyAddressSection } from "@/components/policies/PropertyAddressSection";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { FileDropzone } from "@/components/upload/FileDropzone";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/quote-recaps-api";
import { LeadContextHeader } from "./LeadContextHeader";
import {
  emptyQuoteRecap,
  quoteRecapSchema,
  type QuoteRecapFormValues,
} from "./quote-recap-schema";

interface QuoteRecapFormProps {
  context: QuoteRecapLeadContext;
  submitting: boolean;
  errorMessage: string | null;
  onSubmit: (values: QuoteRecapFormValues) => void;
}

export function QuoteRecapForm({
  context,
  submitting,
  errorMessage,
  onSubmit,
}: QuoteRecapFormProps) {
  const form = useForm<QuoteRecapFormValues>({
    resolver: zodResolver(quoteRecapSchema),
    // Default the toggle on only when there is actually an address to copy.
    // Otherwise the fields would be blank *and* disabled, the conditional
    // required rule would fire, and the producer would be stuck.
    defaultValues: emptyQuoteRecap(Boolean(context.householdAddress)),
    mode: "onBlur",
  });

  const policies = useWatch({ control: form.control, name: "policies" });
  const hasPropertyPolicy = (policies ?? []).some((p) =>
    isPropertyPolicyType(p?.policyType),
  );
  const blocked = !context.householdId;

  return (
    // `Form` *is* `FormProvider` — one wrapper is enough. (`LeadIntakeForm`
    // wraps in both; that is redundant and not repeated here.)
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-6"
        noValidate
      >
        <LeadContextHeader context={context} />

        <FormSection
          title="Quoted policies"
          description="One row per policy. The totals are calculated for you."
        >
          <PolicyRowsField />
          {form.formState.errors.policies?.root && (
            <p className="text-sm text-destructive">
              {form.formState.errors.policies.root.message}
            </p>
          )}
        </FormSection>

        {hasPropertyPolicy && (
          <PropertyAddressSection
            householdAddress={context.householdAddress}
          />
        )}

        <FormSection title="Quote document" description="The carrier quote. Required.">
          <FormField
            control={form.control}
            name="quoteDocument"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <FileDropzone
                    accept={ALLOWED_UPLOAD_TYPES}
                    maxBytes={MAX_UPLOAD_BYTES}
                    file={field.value ?? null}
                    onSelect={field.onChange}
                    hint="PDF, JPG, PNG up to 10MB"
                    disabled={submitting}
                    aria-label="Upload the quote document"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection title="Notes">
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="sr-only">Notes</FormLabel>
                <FormControl>
                  <Textarea
                    rows={4}
                    className="bg-card border-border"
                    placeholder="Anything the next person needs to know about this proposal."
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
    </Form>
  );
}
