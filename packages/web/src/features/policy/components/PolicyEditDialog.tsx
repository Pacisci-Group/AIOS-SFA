import type { UpdatePolicyInput } from "@sfa/shared";
import {
  POLICY_STATUS_OPTIONS,
  POLICY_TYPE_OPTIONS,
  isCanonicalPolicyType,
  itemCountLabel,
  policyTypeHasItemCount,
  premiumTermLabel,
} from "@sfa/shared";
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
import {
  policyFormSchema,
  toUpdatePolicyInput,
  type PolicyFormValues,
} from "./policy-schema";

interface PolicyEditDialogProps<T> {
  /**
   * The stored policy, in whatever shape the calling page holds it.
   *
   * Passed as the record rather than as seeded values so the re-seed effect can
   * depend on a **stable reference** from the query cache. Values built inline
   * by the caller would be a new object every render, and the effect would reset
   * the form on each one — clearing whatever was half-typed.
   */
  record: T;
  toValues: (record: T) => PolicyFormValues;
  /** Names the policy in the trigger's accessible label. */
  label: string;
  title: string;
  description: string;
  /**
   * The caller's permission gate, already evaluated.
   *
   * The two pages answer it differently — the Sold card asks for
   * `deal_audits:write`, the household card for `clients:write` or
   * `crm_service:write` — and neither should be hard-coded in here.
   */
  canEdit: boolean;
  isPending: boolean;
  /** Rejects on failure; the dialog stays open and the hook has already toasted. */
  onSave: (input: UpdatePolicyInput) => Promise<unknown>;
}

/**
 * The policy quick edit, shared by the Lead Detail Sold card (PAC-56 #27) and
 * the household policy card (PAC-126).
 *
 * Deliberately a *field* correction, not a re-submission: the Sold wizard owns
 * creating the deal, its policies and the audit items it triggers, and
 * re-running any of that from here would duplicate the hand-off.
 *
 * ## The renewal date is not a field here
 *
 * `renewalDate` is derived — the next occurrence of the term, counted from the
 * effective date — and the API refuses it from a client, because an anchor that
 * disagrees with the effective date schedules real calls to real clients on the
 * wrong day. Correcting the effective date or the policy type re-derives it
 * server-side, and the saved row comes back carrying the new one. That is the
 * whole mechanism behind PAC-126: the operator types the date they can see on
 * the declaration page, and the date they cannot compute appears on the card.
 *
 * Self-gating and returning `null`, matching `EditContactDialog` /
 * `SoldDealAction`, so neither card has to check first.
 */
export function PolicyEditDialog<T>({
  record,
  toValues,
  label,
  title,
  description,
  canEdit,
  isPending,
  onSave,
}: PolicyEditDialogProps<T>) {
  const [open, setOpen] = useState(false);

  const form = useAppForm({
    defaultValues: toValues(record),
    validators: { onBlur: policyFormSchema },
    onSubmit: async ({ value }) => {
      try {
        await onSave(toUpdatePolicyInput(value));
        setOpen(false);
      } catch {
        // Left open so the operator can correct and retry. The mutation hooks
        // own the message — a second toast here would double every failure.
      }
    },
  });

  // Re-seed on open so a cancelled edit doesn't persist, and so the form
  // reflects any change made since this component mounted.
  useEffect(() => {
    if (!open) return;
    form.reset(toValues(record));
    // `form` is a stable instance (useForm holds it in useState), so it does not
    // need to be a dependency. `toValues` is a pure mapper the caller may define
    // inline; depending on it would reset the form on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record]);

  // Subscribed, not read off the prop: the type is editable in this dialog, so
  // the count's label has to follow the pending choice rather than the saved
  // one — switching Home to Auto should say "Number of Vehicles" immediately.
  const policyType = useStore(form.store, (s) => s.values.policyType);

  /*
   * Asked only where the count is a real question — the vehicle types. A Home
   * or Umbrella policy is one thing, so `toUpdatePolicyInput` sends 1 for it
   * and the field is not shown.
   *
   * An **unrecognised** stored type seeds as `""` (see `policy-schema.ts`), and
   * that keeps the field: we cannot claim the implied 1 for a type we cannot
   * name, and this dialog is the only way to correct such a row.
   */
  const asksItemCount =
    policyTypeHasItemCount(policyType) || !isCanonicalPolicyType(policyType);

  if (!canEdit) return null;

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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
                    // Follows the pending type, like the item count below:
                    // switching Home to Auto must say "6-month premium" before
                    // the number is typed, not after it is saved.
                    label={premiumTermLabel(policyType)}
                    // Takes the count's cell when there is no count.
                    className={!asksItemCount ? "sm:col-span-2" : undefined}
                    min="0"
                    step="1"
                    inputClassName="bg-card border-border"
                  />
                )}
              </form.AppField>
              {asksItemCount && (
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
              )}
            </FormGrid>

            <FormGrid>
              <form.AppField name="effectiveDate">
                {(f) => (
                  <f.TextField
                    label="Effective date"
                    // The renewal date is counted from this one, so correcting
                    // it is what gives an undated policy an anchor at all.
                    description="Sets the renewal date"
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
                <f.SelectField
                  label="Status"
                  options={POLICY_STATUS_OPTIONS}
                  placeholder="Not recognised — pick one"
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>

            <p className="text-xs text-muted-foreground">
              Leave a field blank to clear it. Premium, items, type and status
              are left unchanged when blank.
            </p>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 size={14} className="animate-spin" />}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
