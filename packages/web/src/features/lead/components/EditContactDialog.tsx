import type { LeadDetailContact } from "@sfa/shared";
import { ModuleKey } from "@sfa/shared";
import { Loader2, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { FormGrid } from "@/components/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAppForm } from "@/hooks/form";
import { usePermissions } from "@/hooks/usePermissions";
import {
  contactFormSchema,
  toUpdateContactInput,
  type ContactFormValues,
} from "./contact-schema";
import { useUpdateContact } from "./useUpdateContact";

interface EditContactDialogProps {
  leadId: string;
  contact: LeadDetailContact;
}

/**
 * Legacy's "Edit Primary Contact", ported (PAC-38).
 *
 * Gates itself on **`clients:write`**, not `leads:write` — a `Contact` is a CRM
 * record shared across the household, so `PATCH /contacts/:id` lives under the
 * `clients` module. PAC-38 added that permission to the Producer template; the
 * server still derives per-contact reach from the caller's own leads, so this
 * check is about showing the control, not about authorization.
 *
 * Self-gating and returning `null`, matching `QuoteRecapAction` /
 * `SoldDealAction`, so the card doesn't have to check first.
 */
export function EditContactDialog({ leadId, contact }: EditContactDialogProps) {
  const { canWrite } = usePermissions();
  const [open, setOpen] = useState(false);
  const mutation = useUpdateContact(leadId, contact.id);

  const seed = (): ContactFormValues => ({
    firstName: contact.firstName,
    lastName: contact.lastName,
    // The API already returns `YYYY-MM-DD`, which is exactly what
    // `<input type="date">` wants — no parsing on either side.
    dateOfBirth: contact.dateOfBirth ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
  });

  const form = useAppForm({
    defaultValues: seed(),
    validators: { onBlur: contactFormSchema },
    onSubmit: ({ value }) => {
      mutation.mutate(toUpdateContactInput(value), {
        onSuccess: () => setOpen(false),
      });
    },
  });

  // Re-seed when the dialog opens so a cancelled edit doesn't persist, and so
  // the form reflects any change made since this component mounted.
  useEffect(() => {
    if (!open) return;
    form.reset(seed());
    // `form` is a stable instance (useForm holds it in useState), so it does not
    // need to be a dependency the way react-hook-form's context object did.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contact]);

  if (!canWrite(ModuleKey.Clients)) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          aria-label={`Edit ${contact.name}`}
        >
          <Pencil size={12} />
          Edit
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit primary contact</DialogTitle>
          <DialogDescription>
            Corrections here also update how this lead appears on the Leads
            list.
          </DialogDescription>
        </DialogHeader>

        <form.AppForm>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
            className="space-y-4"
            noValidate
          >
            <FormGrid>
              <form.AppField name="firstName">
                {(f) => (
                  <f.TextField
                    label="First name"
                    inputClassName="bg-card border-border"
                  />
                )}
              </form.AppField>
              <form.AppField name="lastName">
                {(f) => (
                  <f.TextField
                    label="Last name"
                    inputClassName="bg-card border-border"
                  />
                )}
              </form.AppField>
            </FormGrid>

            <form.AppField name="dateOfBirth">
              {(f) => (
                <f.TextField
                  label="Date of birth"
                  type="date"
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>

            <form.AppField name="email">
              {(f) => (
                <f.TextField
                  label="Email"
                  type="email"
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>

            <form.AppField name="phone">
              {(f) => (
                <f.TextField
                  label="Phone"
                  type="tel"
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>

            <p className="text-xs text-muted-foreground">
              Leave a field blank to clear it.
            </p>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
