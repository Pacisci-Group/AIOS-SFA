import { zodResolver } from "@hookform/resolvers/zod";
import { SELECTABLE_LEAD_SOURCE_OPTIONS } from "@sfa/shared";
import { useForm, FormProvider } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HouseholdMembersField } from "./HouseholdMembersField";
import {
  EMPTY_LEAD_INTAKE,
  makeLeadIntakeSchema,
  type LeadIntakeFormValues,
} from "./lead-intake-schema";

interface LeadIntakeFormProps {
  /**
   * The authenticated form asks for a lead source; the public one never does.
   * Lead source is internal vocabulary (Quotewizard, Soleo, Data Lot, JYA) and
   * is meaningless — sometimes revealing — to an outside submitter, so a
   * producer sets it after the fact.
   */
  showLeadSource: boolean;
  submitting: boolean;
  errorMessage: string | null;
  submitLabel?: string;
  onSubmit: (values: LeadIntakeFormValues) => void;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground">
      {children}
    </h2>
  );
}

/**
 * The New Lead form itself (PAC-37) — one component behind both entry points.
 *
 * It owns the form state and nothing else: the wrappers own the mutation, the
 * submission token, and what happens on success. That split is what lets the
 * authenticated page navigate to the created lead while the public page shows a
 * bare confirmation, without either duplicating the fields or the validation.
 */
export function LeadIntakeForm({
  showLeadSource,
  submitting,
  errorMessage,
  submitLabel = "Create lead",
  onSubmit,
}: LeadIntakeFormProps) {
  const form = useForm<LeadIntakeFormValues>({
    resolver: zodResolver(makeLeadIntakeSchema(showLeadSource)),
    defaultValues: EMPTY_LEAD_INTAKE,
    mode: "onBlur",
  });

  return (
    <FormProvider {...form}>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-6"
          noValidate
        >
          <section className="rounded-xl bg-card border border-border p-4 md:p-5 space-y-4">
            <SectionHeading>Primary contact</SectionHeading>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="primaryContact.firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="given-name"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="primaryContact.lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="family-name"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="primaryContact.dateOfBirth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date of birth</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="primaryContact.phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="(555) 123-4567"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="primaryContact.email"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </section>

          <section className="rounded-xl bg-card border border-border p-4 md:p-5 space-y-4">
            <div>
              <SectionHeading>Household address</SectionHeading>
              <p className="mt-1 text-xs text-muted-foreground">
                Where the household lives — not the insured property address,
                which is captured on the quote.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="address.street"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Street</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="address-line1"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address.city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="address-level2"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address.state"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>State</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="address-level1"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address.zip"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ZIP</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="numeric"
                        autoComplete="postal-code"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </section>

          {showLeadSource ? (
            <section className="rounded-xl bg-card border border-border p-4 md:p-5 space-y-4">
              <SectionHeading>Lead source</SectionHeading>
              <FormField
                control={form.control}
                name="leadSourceCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Where did this lead come from?</FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full bg-card border-border">
                          <SelectValue placeholder="Select a source" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {/* `Test` is excluded at the source — a lead created
                            with it would be silently hidden from every list. */}
                        {SELECTABLE_LEAD_SOURCE_OPTIONS.map((option) => (
                          <SelectItem key={option.code} value={option.code}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </section>
          ) : null}

          <section className="rounded-xl bg-card border border-border p-4 md:p-5 space-y-4">
            <div>
              <SectionHeading>Additional household members</SectionHeading>
              <p className="mt-1 text-xs text-muted-foreground">
                Spouse, children, and any other drivers on the policy.
              </p>
            </div>
            <HouseholdMembersField />
          </section>

          {errorMessage ? (
            <div
              role="alert"
              className="px-4 py-3 rounded-lg text-sm bg-amber-500/10 border border-amber-500/25 text-amber-500"
            >
              {errorMessage}
            </div>
          ) : null}

          <Button
            type="submit"
            disabled={submitting}
            className="w-full sm:w-auto bg-gradient-to-br from-sky-400 to-sky-500 text-primary-foreground font-semibold hover:brightness-110 active:scale-95"
          >
            {submitting ? "Submitting…" : submitLabel}
          </Button>
        </form>
      </Form>
    </FormProvider>
  );
}
