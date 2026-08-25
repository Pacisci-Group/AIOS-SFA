import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-form";
import { Loader2 } from "lucide-react";
import { FieldShell, useFieldError } from "@/components/form/fields";
import { withForm } from "@/hooks/form";
import { searchPolicies } from "@/lib/policies-api";
import { emptyPolicy } from "./sold-deal-schema";

const money = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

/**
 * Which policy this new one replaces — the transfer variant's first loop card.
 *
 * **Restricted to the ticket's household**, not the agency's whole book. A
 * transfer is a client moving within their own package; offering every policy
 * in the agency would make picking the wrong one a matter of one mis-click, and
 * the server rejects a cross-household pairing anyway.
 *
 * A radio list rather than a search combobox: a household has a handful of
 * policies, all of which fit on screen, and seeing the premium beside each is
 * the whole point — the CSR is looking for the expensive one.
 */
export const TransferFromCard = withForm({
  defaultValues: emptyPolicy("transfer"),
  props: { householdId: null as string | null },
  render: function Render({ form, householdId }) {
    const query = useQuery({
      queryKey: ["policies", "household", householdId],
      // The empty term returns the household's policies; the household filter
      // is what narrows it, not the search string.
      queryFn: () => searchPolicies("", 50, householdId),
      enabled: Boolean(householdId),
    });

    const selected = useStore(form.store, (s) => s.values.fromPolicyId);
    // Committed rows are not excluded: the picker shows the household's book as
    // it stands, and the server's one-transfer-per-policy invariant is what
    // stops the same policy being retired twice.
    const policies = (query.data ?? []).filter((policy) => policy.active);

    return (
      <form.AppField name="fromPolicyId">
        {(field) => (
          <FieldShell
            label="Policy being replaced"
            description="The client's current policy. It is cancelled when this transfer is recorded."
            error={useFieldError(field.state.meta)}
          >
            {() =>
              query.isPending && householdId ? (
                <p className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading this household's policies…
                </p>
              ) : policies.length === 0 ? (
                <p className="py-4 text-xs text-muted-foreground">
                  This household has no active policies to transfer from.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {policies.map((policy) => {
                    const isSelected = selected === policy.id;
                    return (
                      <button
                        key={policy.id}
                        type="button"
                        onClick={() => field.handleChange(policy.id)}
                        aria-pressed={isSelected}
                        className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-muted"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">
                            {policy.policyNumber ?? "No number"}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[policy.policyType, policy.carrier]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-medium text-muted-foreground">
                          {money(policy.premium)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )
            }
          </FieldShell>
        )}
      </form.AppField>
    );
  },
});
