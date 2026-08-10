import { Trash2 } from "lucide-react";
import { FormSection } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SoldPolicyFormValues } from "./sold-deal-schema";

interface PolicySummaryListProps {
  policies: SoldPolicyFormValues[];
  onRemove: (index: number) => void;
  disabled?: boolean;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/**
 * The policies committed so far.
 *
 * Standing in for the progress a linear stepper cannot express: after the loop
 * re-enters the policy-type card the step counter resets, so this list is the
 * producer's only
 * record of what the submission already contains — and their only chance to
 * catch a mistyped policy before it is booked.
 */
export function PolicySummaryList({
  policies,
  onRemove,
  disabled,
}: PolicySummaryListProps) {
  if (!policies.length) return null;

  return (
    <FormSection
      title="Policies on this sale"
      titleAs="h3"
      className="space-y-3"
    >
      <ul className="space-y-2">
        {policies.map((policy, index) => (
          <li
            key={`${policy.policyNumber}-${index}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/40 p-3"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{policy.policyType}</Badge>
                <span className="truncate text-sm text-foreground">
                  {policy.policyNumber}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {policy.carrier} ·{" "}
                {currency.format(Number(policy.premium) || 0)} ·{" "}
                {policy.itemCount}{" "}
                {Number(policy.itemCount) === 1 ? "item" : "items"}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onRemove(index)}
              aria-label={`Remove policy ${policy.policyNumber}`}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 size={14} />
            </Button>
          </li>
        ))}
      </ul>
    </FormSection>
  );
}
