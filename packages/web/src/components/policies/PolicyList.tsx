import { isPropertyPolicyType, itemCountNoun } from "@sfa/shared";
import { Home, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAddress, type AddressLike } from "@/lib/format-address";
import { cn } from "@/lib/utils";

/** Same ceiling as both zod schemas and the API DTOs. */
export const MAX_POLICIES = 12;

/** One committed policy, reduced to what the summary row shows. */
export interface PolicyListItem {
  policyType: string;
  itemCount: string;
  /** Quote Recap only — the New Lead form has no premium to show. */
  premium?: string;
  sameAsHousehold: boolean;
  propertyAddress: AddressLike;
}

interface PolicyListProps {
  policies: PolicyListItem[];
  onAdd: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  /** The array-level message ("Add at least one policy"). */
  error?: string;
  /** Copy for the empty state — the two forms ask for different things. */
  emptyMessage: string;
  disabled?: boolean;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * The policies added so far, each editable and removable (PAC-56 #15).
 *
 * The counterpart to {@link PolicySheet}: the drawer is where a policy is
 * written, this is the record of what the submission now contains. Together
 * they replace the stack of always-expanded inline rows, which could not carry
 * a per-policy address without burying the rest of the form.
 *
 * Read-only by design — every field is edited in the drawer. A row that was
 * half-editable inline and half-editable in a drawer would need the address
 * rule enforced in two places.
 */
export function PolicyList({
  policies,
  onAdd,
  onEdit,
  onRemove,
  error,
  emptyMessage,
  disabled,
}: PolicyListProps) {
  return (
    <div className="space-y-3">
      {policies.length === 0 ? (
        <p
          className={cn(
            "rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {emptyMessage}
        </p>
      ) : (
        <ul className="space-y-2">
          {policies.map((policy, index) => {
            const address = isPropertyPolicyType(policy.policyType)
              ? formatAddress(policy.propertyAddress)
              : null;
            const premium = policy.premium?.trim()
              ? currency.format(Number(policy.premium) || 0)
              : null;
            const count = Number(policy.itemCount) || 0;

            return (
              <li
                key={index}
                className="flex items-start justify-between gap-3 rounded-lg border border-border bg-sunken p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{policy.policyType}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {count} {itemCountNoun(policy.policyType, count)}
                      {premium ? ` · ${premium}` : ""}
                    </span>
                  </div>
                  {/*
                    Omitted entirely for a policy that insures no building — a
                    dash there would read as an address we failed to collect
                    rather than a question that was never asked.
                  */}
                  {address && (
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Home size={12} className="mt-0.5 shrink-0" />
                      <span className="break-words">
                        {address}
                        {policy.sameAsHousehold && (
                          <span className="ml-1 opacity-70">
                            (same as household)
                          </span>
                        )}
                      </span>
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onEdit(index)}
                    aria-label={`Edit policy ${index + 1}`}
                    className="h-7 px-2 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onRemove(index)}
                    aria-label={`Remove policy ${index + 1}`}
                    className="h-7 px-2 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* The array-level message. Field-level errors never reach here: the
          drawer validates a policy before it is ever committed to the list. */}
      {error && policies.length > 0 && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || policies.length >= MAX_POLICIES}
        onClick={onAdd}
      >
        <Plus size={14} />
        Add policy
      </Button>
    </div>
  );
}
