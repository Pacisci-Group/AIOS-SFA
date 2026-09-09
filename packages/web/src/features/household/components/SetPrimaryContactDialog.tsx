import type { ContactSummary, HouseholdView } from "@sfa/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChoiceRow } from "@/components/common/ChoiceRow";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { setPrimaryContact } from "@/lib/households-api";

/** The sentinel for "leave the household without a primary contact". */
const NO_PRIMARY = "__none__";

function fullName(contact: ContactSummary): string {
  return (
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    "Unnamed contact"
  );
}

/**
 * "Change primary contact" on the Household page (PAC-91 §7).
 *
 * The general-purpose half of the operation. Succession after a death is one
 * reason to use it; a divorce, or a primary picked wrongly at intake, are the
 * ordinary ones — and until this existed there was **no supported way to change
 * a household's primary contact at all**, because `primaryContactId` was only
 * ever filled by intake and never reassigned.
 *
 * ── The list is the household's own roster ─────────────────────────────────
 * Only current members are offered, because only a member can lead a household:
 * a primary who is not on the roster disappears from the very page that names
 * them. Deceased members are shown but not selectable, rather than hidden —
 * they are on the roster in front of the user, and silently omitting one reads
 * as a bug. The server enforces both rules again, plus the one this page cannot
 * see: a contact is the primary of at most one household, so somebody who
 * already leads another is refused with a 409 naming it.
 */
export function SetPrimaryContactDialog({
  household,
  open,
  onOpenChange,
}: {
  household: HouseholdView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const current = household.contacts.find((contact) => contact.isPrimary);
  const [choice, setChoice] = useState<string | null>(null);

  // Cleared on open so a cancelled choice never resurfaces in the next one.
  useEffect(() => {
    if (open) setChoice(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: (value: string) =>
      setPrimaryContact(
        household.id,
        value === NO_PRIMARY
          ? { contactId: null, allowNoPrimary: true }
          : { contactId: value },
      ),
    onSuccess: (updated) => {
      // The response is the whole household, so seed the cache with it rather
      // than refetching: the roster's `isPrimary`, the resolved primary email
      // and phone, and the data-quality flag all moved together.
      queryClient.setQueryData(["household", household.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["households"] });
      toast.success("Primary contact updated");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Couldn't change the primary contact");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change primary contact</DialogTitle>
          <DialogDescription>
            {current
              ? `${fullName(current)} leads this household today. Pick who leads it instead.`
              : "This household has no primary contact. Pick who leads it."}
          </DialogDescription>
        </DialogHeader>

        <div
          role="radiogroup"
          aria-label="Primary contact"
          className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto"
        >
          {household.contacts
            .filter((contact) => contact.id !== current?.id)
            .map((contact) => (
              <ChoiceRow
                key={contact.id}
                selected={choice === contact.id}
                disabled={Boolean(contact.deceasedAt)}
                onSelect={() => setChoice(contact.id)}
                title={fullName(contact)}
                caption={
                  contact.deceasedAt
                    ? "Deceased — cannot lead a household"
                    : (contact.roleInHousehold ?? "Household member")
                }
              />
            ))}
          <ChoiceRow
            selected={choice === NO_PRIMARY}
            onSelect={() => setChoice(NO_PRIMARY)}
            title="No primary contact"
            caption="Flags the household for the office to come back to."
          />
        </div>

        {household.contacts.length <= 1 && (
          <p className="text-xs text-muted-foreground">
            Nobody else is on this household&rsquo;s roster. Add a member first
            if somebody else should lead it.
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
          <Button
            type="button"
            disabled={mutation.isPending || !choice}
            onClick={() => mutation.mutate(choice!)}
          >
            {mutation.isPending && (
              <Loader2 size={14} className="animate-spin" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
