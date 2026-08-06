import { POLICY_TYPE_OPTIONS, type PolicyType } from "@sfa/shared";
import { Plus, X } from "lucide-react";
import { FormGrid, FormSubPanel } from "@/components/form";
import { Button } from "@/components/ui/button";
import { withFieldGroup } from "@/hooks/form";

const MAX_POLICIES = 12;

/**
 * The fields one policy row owns — and **only** the ones both forms share.
 *
 * Premium is deliberately absent. The Quote Recap records what a policy costs;
 * the New Lead form asks the same question *before* a quote exists, where nobody
 * — least of all a prospect — can answer it. The previous version modelled that
 * with an optional `premium` plus a `showPremium` boolean, which does not
 * typecheck here: a field group requires every key it declares to exist on the
 * parent, and the New Lead schema has no premium at all. The compiler was right
 * — `showPremium` was a flag making one component behave as two. Quote Recap now
 * composes its premium field in through `children`.
 */
/**
 * `policyType` is annotated rather than left to inference: a bare `"Auto"`
 * widens to `string`, which then fails to line up with either parent's
 * `z.enum(POLICY_TYPES)` and makes the `fields` path unresolvable.
 */
const policyRowDefaults = {
  policyType: "Auto" as PolicyType,
  itemCount: "1",
};

/**
 * One policy row. Paths are relative to the group, so nothing here names the
 * parent's array — that lives entirely at the call site, which is what makes
 * renaming it a compile error instead of the silent runtime break it used to be.
 */
const PolicyRowGroup = withFieldGroup({
  defaultValues: policyRowDefaults,
  props: { index: 0, columns: 2 as 2 | 3, onRemove: undefined as (() => void) | undefined },
  render: function Render({ group, index, columns, onRemove, children }) {
    return (
      <FormSubPanel
        title={`Policy ${index + 1}`}
        action={
          onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground hover:text-foreground"
              onClick={onRemove}
              aria-label={`Remove policy ${index + 1}`}
            >
              <X size={14} />
            </Button>
          ) : null
        }
      >
        <FormGrid gap={3} columns={columns}>
          <group.AppField name="policyType">
            {(f) => (
              <f.SelectField
                label="Policy type"
                options={POLICY_TYPE_OPTIONS}
                triggerClassName="w-full bg-card border-border"
              />
            )}
          </group.AppField>
          {/* Slot between type and count — where Quote Recap puts premium. */}
          {children}
          <group.AppField name="itemCount">
            {(f) => (
              <f.NumberField
                label="Item count"
                inputMode="numeric"
                min="1"
                inputClassName="bg-card border-border"
              />
            )}
          </group.AppField>
        </FormGrid>
      </FormSubPanel>
    );
  },
});

interface PolicyRowsShellProps {
  onAdd: () => void;
  count: number;
  children: React.ReactNode;
}

/**
 * The add button and spacing around a set of policy rows.
 *
 * One row is always present: the remove button is hidden at a single row, which
 * enforces "at least one policy" as an affordance rather than an error the user
 * has to read. Each form's zod `.min(1)` remains the actual guarantee.
 */
export function PolicyRowsShell({
  onAdd,
  count,
  children,
}: PolicyRowsShellProps) {
  return (
    <div className="space-y-3">
      {children}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={count >= MAX_POLICIES}
        onClick={onAdd}
      >
        <Plus size={14} />
        Add policy
      </Button>
    </div>
  );
}

export { PolicyRowGroup, MAX_POLICIES };
