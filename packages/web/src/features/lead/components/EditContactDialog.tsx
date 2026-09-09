import type { LeadDetailContact, SuccessionRequiredError } from "@sfa/shared";
import { ModuleKey, SUCCESSION_REQUIRED_CODE } from "@sfa/shared";
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
import { ApiError } from "@/lib/api-client";
import {
  contactFormSchema,
  toUpdateContactInput,
  type ContactFormValues,
} from "./contact-schema";
import { SuccessionStep } from "./SuccessionStep";
import { useUpdateContact } from "./useUpdateContact";

interface EditContactDialogProps {
  leadId: string;
  contact: LeadDetailContact;
}

/**
 * The succession 409, narrowed by `code` (PAC-91 §7).
 *
 * By `code`, never by the message: the message is written for a human and will
 * be reworded, and a client branching on its text would break silently when it
 * was.
 */
function asSuccessionRequired(
  error: unknown,
): SuccessionRequiredError | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const body = error.body as Partial<SuccessionRequiredError> | undefined;
  return body?.code === SUCCESSION_REQUIRED_CODE
    ? (body as SuccessionRequiredError)
    : null;
}

/**
 * Legacy's "Edit Primary Contact", ported (PAC-38), plus the deceased marker
 * (PAC-91 §7).
 *
 * Gates itself on **`clients:write`**, not `leads:write` — a `Contact` is a CRM
 * record shared across the household, so `PATCH /contacts/:id` lives under the
 * `clients` module. PAC-38 added that permission to the Producer template; the
 * server still derives per-contact reach from the caller's own leads, so this
 * check is about showing the control, not about authorization.
 *
 * Self-gating and returning `null`, matching `QuoteRecapAction` /
 * `SoldDealAction`, so the card doesn't have to check first.
 *
 * ── Succession is asked for only when it is actually needed ─────────────────
 * Recording a death on somebody who leads a household cannot stand alone — it
 * would leave that household headed by a dead person. Rather than pre-emptively
 * asking every time the date field is filled in, the form submits and lets the
 * API answer: a **409 `primary_contact_succession_required`** comes back
 * carrying the household and the members eligible to take over, and the dialog
 * switches to {@link SuccessionStep} to put exactly that question. A contact who
 * leads nothing never sees it, and the eligibility rules are decided in one
 * place on the server rather than guessed at from whatever roster this page
 * happens to hold.
 */
export function EditContactDialog({ leadId, contact }: EditContactDialogProps) {
  const { canWrite } = usePermissions();
  const [open, setOpen] = useState(false);
  const [succession, setSuccession] = useState<SuccessionRequiredError | null>(
    null,
  );
  const mutation = useUpdateContact(leadId, contact.id);

  const seed = (): ContactFormValues => ({
    firstName: contact.firstName,
    lastName: contact.lastName,
    // The API already returns `YYYY-MM-DD`, which is exactly what
    // `<input type="date">` wants — no parsing on either side.
    dateOfBirth: contact.dateOfBirth ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    deceasedAt: contact.deceasedAt ?? "",
  });

  const form = useAppForm({
    defaultValues: seed(),
    validators: { onBlur: contactFormSchema },
    onSubmit: ({ value }) => {
      mutation.mutate(toUpdateContactInput(value), {
        onSuccess: () => setOpen(false),
        onError: (error) => setSuccession(asSuccessionRequired(error)),
      });
    },
  });

  // Re-seed when the dialog opens so a cancelled edit doesn't persist, and so
  // the form reflects any change made since this component mounted. The
  // succession question is cleared with it: it belongs to one submission.
  useEffect(() => {
    if (!open) return;
    setSuccession(null);
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
        {succession ? (
          <SuccessionStep
            error={succession}
            contactName={contact.name}
            pending={mutation.isPending}
            onCancel={() => setSuccession(null)}
            onChoose={(answer) => {
              mutation.mutate(
                toUpdateContactInput(form.state.values, answer),
                {
                  onSuccess: () => {
                    setSuccession(null);
                    setOpen(false);
                  },
                  // A second refusal replaces the first — the successor may
                  // have been picked from a stale roster, and the fresh 409
                  // carries the current candidates.
                  onError: (error) =>
                    setSuccession(asSuccessionRequired(error) ?? succession),
                },
              );
            }}
          />
        ) : (
          <>
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

                {/*
                 * Its own block, below a rule, because it is a different kind of
                 * edit from the four above: those correct what we know about a
                 * living person, this records that they have died. Clearing the
                 * date undoes it — a death recorded in error has to be
                 * reversible, which is half the reason PAC-91 §7 made this a
                 * date rather than a delete.
                 */}
                <div className="space-y-2 border-t border-border pt-4">
                  <form.AppField name="deceasedAt">
                    {(f) => (
                      <f.TextField
                        label="Date of death"
                        type="date"
                        inputClassName="bg-card border-border"
                      />
                    )}
                  </form.AppField>
                  <p className="text-xs text-muted-foreground">
                    Leave blank if this person is living. A deceased contact
                    stays on past policies and tickets, but is no longer matched
                    by intake or offered for new quotes.
                  </p>
                </div>

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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
