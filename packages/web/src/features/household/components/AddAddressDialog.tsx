import type { HouseholdView } from "@sfa/shared";
import {
  DEFAULT_ADDRESS_STATE,
  HOUSEHOLD_ADDRESS_LABEL_MAX,
} from "@sfa/shared";
import { useStore } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { AddressFields } from "@/components/address/AddressFields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppForm } from "@/hooks/form";
import { addHouseholdAddress } from "@/lib/households-api";
import { householdDetailKey } from "./useUpdateHouseholdPolicy";

const required = z.string().trim().min(1, "Required");

/**
 * The New Lead form's household address rules — four required parts, the same
 * lengths — plus the unit line and an optional name for the entry.
 */
const addressSchema = z.object({
  address: z.object({
    street: required.max(200, "Too long"),
    city: required.max(120, "Too long"),
    state: required.max(60, "Too long"),
    zip: required.max(20, "Too long"),
  }),
  street2: z.string().trim().max(200, "Too long"),
  label: z.string().trim().max(HOUSEHOLD_ADDRESS_LABEL_MAX, "Too long"),
  makePrimary: z.boolean(),
});

type AddressFormValues = z.infer<typeof addressSchema>;

const empty = (makePrimary: boolean): AddressFormValues => ({
  address: { street: "", city: "", state: DEFAULT_ADDRESS_STATE, zip: "" },
  street2: "",
  label: "",
  makePrimary,
});

/**
 * Add an address to the household — by default as its new primary, which is
 * what "the client moved" means.
 *
 * Opened from two places: the address block's **Add address**, and the
 * "update the client's address?" prompt that follows a cancellation. Making it
 * primary keeps the old address on the household as a previous one; unticking
 * it files the new one in the address book under an optional name instead.
 *
 * The response is the whole household, so it is written straight into the
 * cache — the profile's address, the book, and the record the Clients list
 * reads all move together.
 */
export function AddAddressDialog({
  householdId,
  open,
  onOpenChange,
}: {
  householdId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (values: AddressFormValues) =>
      addHouseholdAddress(householdId, {
        ...values.address,
        street2: values.street2.trim() || null,
        // A primary address carries no name — it is simply where they live.
        label: values.makePrimary ? null : values.label.trim() || null,
        makePrimary: values.makePrimary,
      }),
    onSuccess: (updated: HouseholdView, values) => {
      queryClient.setQueryData(householdDetailKey(householdId), updated);
      void queryClient.invalidateQueries({ queryKey: ["households"] });
      toast.success(
        values.makePrimary ? "Primary address updated" : "Address added",
      );
      onOpenChange(false);
    },
  });

  const form = useAppForm({
    defaultValues: empty(true),
    validators: { onBlur: addressSchema },
    onSubmit: ({ value }) => {
      mutation.mutate(value);
    },
  });

  // Cleared on open so a half-typed address never resurfaces in the next one.
  useEffect(() => {
    if (open) {
      form.reset(empty(true));
      mutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const makePrimary = useStore(form.store, (s) => s.values.makePrimary);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add address</DialogTitle>
          <DialogDescription>
            {makePrimary
              ? "This becomes where the household lives. The current address is kept as a previous address."
              : "Kept in the household's address book. The primary address does not change."}
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
            <AddressFields
              form={form}
              fields="address"
              inputClassName="bg-card border-border"
            />

            <form.AppField name="street2">
              {(f) => (
                <f.TextField
                  label="Apt / unit"
                  autoComplete="address-line2"
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>

            <form.AppField name="makePrimary">
              {(f) => <f.CheckboxField label="Make this the primary address" />}
            </form.AppField>

            {!makePrimary && (
              <form.AppField name="label">
                {(f) => (
                  <f.TextField
                    label="Name (optional)"
                    placeholder="e.g. Lake house"
                    inputClassName="bg-card border-border"
                  />
                )}
              </form.AppField>
            )}

            {mutation.isError && (
              <p role="alert" className="text-xs text-destructive">
                {mutation.error instanceof Error
                  ? mutation.error.message
                  : "Could not save the address."}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                Save address
              </Button>
            </DialogFooter>
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
