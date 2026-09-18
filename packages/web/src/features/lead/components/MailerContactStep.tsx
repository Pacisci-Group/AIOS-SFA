import type { MailerLookupView } from "@sfa/shared";
import { ArrowLeft } from "lucide-react";
import { FormError } from "@/components/form";
import { Button } from "@/components/ui/button";
import { useAppForm } from "@/hooks/form";
import {
  contactDetailsSchema,
  type ContactDetailsFormValues,
} from "./lead-intake-schema";

/** The `<form>` id, so the drawer's footer button can submit it from outside. */
export const MAILER_CONTACT_FORM_ID = "mailer-contact-form";

interface MailerContactStepProps {
  mailer: MailerLookupView;
  /** The recipient's address as one line, or `null` when the mailer has none. */
  addressLine: string | null;
  submitting: boolean;
  errorMessage: string | null;
  onBack: () => void;
  onSubmit: (values: ContactDetailsFormValues) => void;
}

/**
 * The Mailers drawer's second step: date of birth, phone and email, required
 * before a mailer lead is created (PAC-103).
 *
 * A mailer names the recipient but almost never says how to reach them, and a
 * contact without all three cannot pass the PAC-91 §9 duplicate check, so a
 * returning recipient would become a second contact. David's rule is that these
 * are always entered; this is where.
 *
 * A step inside the drawer rather than a dialog over it: the lookup stays a
 * read-only view a producer can use without being asked for anything, and there
 * is no second focus trap stacked on the Sheet's.
 *
 * Pre-filled from whatever the mailer does carry. `useAppForm`'s defaults are
 * read on mount only, which is fine here: the drawer mounts this fresh each
 * time the step opens, for one mailer.
 *
 * Renders the body only. The submit button lives in the drawer's footer, which
 * sits outside this form and reaches it through {@link MAILER_CONTACT_FORM_ID}.
 */
export function MailerContactStep({
  mailer,
  addressLine,
  submitting,
  errorMessage,
  onBack,
  onSubmit,
}: MailerContactStepProps) {
  const defaultValues: ContactDetailsFormValues = {
    dateOfBirth: mailer.dateOfBirth ?? "",
    phone: mailer.phone ?? "",
    email: mailer.email ?? "",
  };

  const form = useAppForm({
    defaultValues,
    validators: { onBlur: contactDetailsSchema },
    onSubmit: ({ value }) => onSubmit(value),
  });

  return (
    <div className="space-y-5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 gap-1.5 text-muted-foreground"
        onClick={onBack}
        disabled={submitting}
      >
        <ArrowLeft className="size-4" />
        Back to mailer
      </Button>

      <div className="space-y-1">
        <h3 className="text-base font-semibold">Confirm contact details</h3>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {mailer.name ?? "Name not on file"}
          </span>
          {addressLine && <> · {addressLine}</>}
        </p>
      </div>

      <form.AppForm>
        <form
          id={MAILER_CONTACT_FORM_ID}
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
          className="space-y-4"
          noValidate
        >
          <FormError icon>{errorMessage}</FormError>

          <form.AppField name="dateOfBirth">
            {(f) => (
              <f.TextField
                label="Date of birth"
                type="date"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="phone">
            {(f) => (
              <f.TextField
                label="Phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="(555) 123-4567"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="email">
            {(f) => (
              <f.TextField
                label="Email"
                type="email"
                inputMode="email"
                autoComplete="off"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>

          <p className="text-xs text-muted-foreground">
            All three are needed to create the lead and to match a returning
            client to the record we already have.
          </p>
        </form>
      </form.AppForm>
    </div>
  );
}
