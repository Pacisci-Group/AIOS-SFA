import type { LeadDetailPolicy } from "@sfa/shared";
import { ModuleKey, POLICY_TYPE_OPTIONS, itemCountLabel } from "@sfa/shared";
import { useStore } from "@tanstack/react-form";
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
  policyFormSchema,
  toPolicyFormValues,
  toUpdatePolicyInput,
} from "./policy-schema";
import { useUpdatePolicy } from "./useUpdatePolicy";

interface EditPolicyDialogProps {
  leadId: string;
  policy: LeadDetailPolicy;
}

/**
 * The Sold card's quick edit (PAC-56 #27).
 *
 * David asked for the Sold card to allow "quick edits to sold policies". Legacy
 * had this as a whole second Fillout form (the Deals `Edit Sold` formula); this
 * is deliberately narrower — the fields a producer gets wrong at the keyboard.
 * Re-running the whole wizard to fix a transposed policy number would also
 * re-generate the audit hand-off.
 *
 * Gated on **`deal_audits:write`**, the same permission the Sold form itself
 * requires: correcting what that form wrote is the same act as writing it. Self
 * -gating and returning `null`, matching `EditContactDialog` / `SoldDealAction`,
 * so the card doesn't have to check first.
 */
export function EditPolicyDialog({ leadId, policy }: EditPolicyDialogProps) {
  const { canWrite } = usePermissions();
  const [open, setOpen] = useState(false);
  const mutation = useUpdatePolicy(leadId, policy.id);

  const form = useAppForm({
    defaultValues: toPolicyFormValues(policy),
    validators: { onBlur: policyFormSchema },
    onSubmit: ({ value }) => {
      mutation.mutate(toUpdatePolicyInput(value), {
        onSuccess: () => setOpen(false),
      });
    },
  });

  // Re-seed on open so a cancelled edit doesn't persist, and so the form
  // reflects any change made since this component mounted.
  useEffect(() => {
    if (!open) return;
    form.reset(toPolicyFormValues(policy));
    // `form` is a stable instance (useForm holds it in useState), so it does not
    // need to be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, policy]);

  // Subscribed, not read off the prop: the type is editable in this dialog, so
  // the count's label has to follow the pending choice rather than the saved
  // one — switching Home to Auto should say "Number of Vehicles" immediately.
  const policyType = useStore(form.store, (s) => s.values.policyType);

  if (!canWrite(ModuleKey.DealAudits)) return null;

  const label = policy.policyNumber
    ? `${policy.policyType} ${policy.policyNumber}`
    : policy.policyType;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          aria-label={`Edit ${label}`}
        >
          <Pencil size={12} />
          Edit
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit sold policy</DialogTitle>
          <DialogDescription>
            Corrections to what was recorded at sale. This does not re-run the
            sold form or regenerate the service hand-off.
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
              <form.AppField name="policyType">
                {(f) => (
                  <f.SelectField
                    label="Policy type"
                    options={POLICY_TYPE_OPTIONS}
                    placeholder="Not recognised — pick one"
                    triggerClassName="w-full bg-card border-border"
                  />
                )}
              </form.AppField>
              <form.AppField name="carrier">
                {(f) => (
                  <f.TextField
                    label="Carrier"
                    inputClassName="bg-card border-border"
                  />
                )}
              </form.AppField>
            </FormGrid>

            <form.AppField name="policyNumber">
              {(f) => (
                <f.TextField
                  label="Policy number"
                  inputClassName="bg-card border-border font-mono"
                />
              )}
            </form.AppField>

            <FormGrid>
              <form.AppField name="premium">
                {(f) => (
                  <f.NumberField
                    label="Annual premium"
                    min="0"
                    step="1"
                    inputClassName="bg-card border-border"
                  />
                )}
              </form.AppField>
              <form.AppField name="items">
                {(f) => (
                  <f.NumberField
                    label={itemCountLabel(policyType)}
                    inputMode="numeric"
                    min="0"
                    step="1"
                    inputClassName="bg-card border-border"
                  />
                )}
              </form.AppField>
            </FormGrid>

            <FormGrid>
              <form.AppField name="effectiveDate">
                {(f) => (
                  <f.TextField
                    label="Effective date"
                    type="date"
                    inputClassName="bg-card border-border"
                  />
                )}
              </form.AppField>
              <form.AppField name="expirationDate">
                {(f) => (
                  <f.TextField
                    label="Expiration date"
                    type="date"
                    inputClassName="bg-card border-border"
                  />
                )}
              </form.AppField>
            </FormGrid>

            <form.AppField name="status">
              {(f) => (
                <f.TextField
                  label="Status"
                  description="Free text — there is no fixed status list yet."
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>

            <p className="text-xs text-muted-foreground">
              Leave a field blank to clear it. Premium and items are left
              unchanged when blank.
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
