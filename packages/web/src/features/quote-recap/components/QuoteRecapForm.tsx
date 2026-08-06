import { zodResolver } from "@hookform/resolvers/zod";
import type { QuoteRecapLeadContext } from "@sfa/shared";
import { isPropertyPolicyType } from "@sfa/shared";
import { useForm, useWatch } from "react-hook-form";
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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground">
      {children}
    </h2>
  );
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

        <section className="rounded-xl bg-card border border-border p-4 md:p-5 space-y-4">
          <div>
            <SectionHeading>Quoted policies</SectionHeading>
            <p className="mt-1 text-xs text-muted-foreground">
              One row per policy. The totals are calculated for you.
            </p>
          </div>
          <PolicyRowsField />
          {form.formState.errors.policies?.root && (
            <p className="text-sm text-destructive">
              {form.formState.errors.policies.root.message}
            </p>
          )}
        </section>

        {hasPropertyPolicy && (
          <PropertyAddressSection
            householdAddress={context.householdAddress}
          />
        )}

        <section className="rounded-xl bg-card border border-border p-4 md:p-5 space-y-4">
          <div>
            <SectionHeading>Quote document</SectionHeading>
            <p className="mt-1 text-xs text-muted-foreground">
              The carrier quote. Required.
            </p>
          </div>
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
        </section>

        <section className="rounded-xl bg-card border border-border p-4 md:p-5 space-y-4">
          <SectionHeading>Notes</SectionHeading>
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
        </section>

        {errorMessage && (
          <div
            role="alert"
            className="px-4 py-3 rounded-lg text-sm bg-amber-500/10 border border-amber-500/25 text-amber-500"
          >
            {errorMessage}
          </div>
        )}

        <Button
          type="submit"
          disabled={submitting || blocked}
          className="w-full sm:w-auto bg-gradient-to-br from-sky-400 to-sky-500 text-primary-foreground font-semibold hover:brightness-110 active:scale-95"
        >
          {submitting ? "Saving…" : "Record quote recap"}
        </Button>
      </form>
    </Form>
  );
}
