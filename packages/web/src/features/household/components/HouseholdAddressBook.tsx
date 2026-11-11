import type { HouseholdView, StoredAddress } from "@sfa/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPin, Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  removeHouseholdAddress,
  setPrimaryHouseholdAddress,
} from "@/lib/households-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { cn } from "@/lib/utils";
import { householdDetailKey } from "./useUpdateHouseholdPolicy";

interface AddressOption {
  /** Select value — `primary`, `mailing`, or `other:<entry id>`. */
  key: string;
  kind: "primary" | "mailing" | "other";
  title: string;
  address: StoredAddress;
  /** The book entry's id, for the two writes; `other` only. */
  entryId?: string;
}

function hasContent(address: StoredAddress | null | undefined) {
  return Boolean(address?.street || address?.city || address?.zip);
}

/** Street, unit and ZIP — the same legs the server compares (`sameAddress`). */
function addressKey(address: StoredAddress) {
  return [address.street, address.street2, address.zip]
    .map((part) => (part ?? "").trim().toLowerCase())
    .join("|");
}

function streetLine(address: StoredAddress) {
  return [address.street, address.street2].filter(Boolean).join(", ");
}

function cityLine(address: StoredAddress) {
  return [address.city, address.state, address.zip].filter(Boolean).join(", ");
}

/**
 * Every address the household holds, primary first.
 *
 * The primary is `propertyAddress` and the mailing address is its own field;
 * neither is in the book (`household-address-book.ts`). A mailing address that
 * is the primary again is not listed twice.
 */
function toOptions(household: HouseholdView): AddressOption[] {
  const options: AddressOption[] = [];
  if (hasContent(household.propertyAddress)) {
    options.push({
      key: "primary",
      kind: "primary",
      title: "Primary",
      address: household.propertyAddress!,
    });
  }
  const mailing = household.mailingAddress;
  if (
    hasContent(mailing) &&
    !(options[0] && addressKey(options[0].address) === addressKey(mailing!))
  ) {
    options.push({
      key: "mailing",
      kind: "mailing",
      title: "Mailing",
      address: mailing!,
    });
  }
  for (const entry of household.otherAddresses) {
    options.push({
      key: `other:${entry.id}`,
      kind: "other",
      title: entry.label ?? "Other address",
      address: entry.address,
      entryId: entry.id,
    });
  }
  return options;
}

/**
 * The household's address, in the profile column — with a dropdown when it
 * holds more than one.
 *
 * A household is one address most of the time, and then this renders exactly
 * the block it always did. Once there is a second — a previous home kept when
 * the client moved, a mailing address, a second home — the block gains a
 * select over all of them, primary first, and the one picked is shown beneath.
 *
 * Writers also get **Add address** (which defaults to moving the household to
 * the new address) and, on an address from the book, **Make primary** and
 * **Remove**. The primary itself cannot be removed, only replaced, so a
 * household never loses the address it lives at by accident. The mailing
 * address is shown but not managed here.
 */
export function HouseholdAddressBook({
  household,
  onAddAddress,
}: {
  household: HouseholdView;
  /**
   * Opens the page's `AddAddressDialog`. Omitted — and every write control with
   * it — when the caller cannot write, or on the demo household.
   */
  onAddAddress?: () => void;
}) {
  const queryClient = useQueryClient();
  const options = toOptions(household);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // A key that no longer exists — the entry just made primary, or removed —
  // falls back to the first option rather than rendering nothing.
  const selected =
    options.find((option) => option.key === selectedKey) ?? options[0];
  const canEdit = Boolean(onAddAddress);

  const onSaved = (updated: HouseholdView, message: string) => {
    queryClient.setQueryData(householdDetailKey(household.id), updated);
    void queryClient.invalidateQueries({ queryKey: ["households"] });
    setSelectedKey(null);
    toast.success(message);
  };

  const makePrimary = useMutation({
    mutationFn: (entryId: string) =>
      setPrimaryHouseholdAddress(household.id, entryId),
    onSuccess: (updated) => onSaved(updated, "Primary address updated"),
    onError: (error: Error) =>
      toast.error(error.message || "Couldn't change the primary address"),
  });

  const remove = useMutation({
    mutationFn: (entryId: string) =>
      removeHouseholdAddress(household.id, entryId),
    onSuccess: (updated) => onSaved(updated, "Address removed"),
    onError: (error: Error) =>
      toast.error(error.message || "Couldn't remove the address"),
  });

  const busy = makePrimary.isPending || remove.isPending;

  return (
    <div className="flex flex-col gap-2">
      {options.length > 1 && (
        <Select
          value={selected.key}
          onValueChange={setSelectedKey}
          disabled={busy}
        >
          <SelectTrigger
            size="sm"
            className="w-full bg-card"
            aria-label={`Addresses (${options.length})`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                <span className="font-medium">{option.title}</span>
                <span className="text-muted-foreground">
                  · {option.address.street || cityLine(option.address)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex items-start gap-2.5 rounded-md bg-muted px-3 py-2">
        <MapPin
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">
            {selected ? streetLine(selected.address) || NOT_AVAILABLE : NOT_AVAILABLE}
          </span>
          <span className="block text-xs text-muted-foreground">
            {selected ? cityLine(selected.address) || NOT_AVAILABLE : NOT_AVAILABLE}
          </span>
        </span>
        {/* Says which one this is when there is no dropdown above to say it. */}
        {selected && options.length === 1 && selected.kind !== "primary" && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {selected.title}
          </span>
        )}
      </div>

      {canEdit && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-1",
            selected?.kind === "other" ? "justify-between" : "justify-end",
          )}
        >
          {selected?.kind === "other" && selected.entryId && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground hover:text-foreground"
                disabled={busy}
                onClick={() => makePrimary.mutate(selected.entryId!)}
              >
                {makePrimary.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Star />
                )}
                Make primary
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground hover:text-foreground"
                disabled={busy}
                onClick={() => remove.mutate(selected.entryId!)}
              >
                {remove.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Trash2 />
                )}
                Remove
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-foreground"
            disabled={busy}
            onClick={onAddAddress}
          >
            <Plus />
            Add address
          </Button>
        </div>
      )}
    </div>
  );
}
