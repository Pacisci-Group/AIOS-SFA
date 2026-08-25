import { HOUSEHOLD_MEMBER_ROLES, type HouseholdMemberRole } from "@sfa/shared";
import { Plus, X } from "lucide-react";
import { FormGrid, FormSubPanel } from "@/components/form";
import { Button } from "@/components/ui/button";
import { withFieldGroup } from "@/hooks/form";

export const MAX_MEMBERS = 10;

/**
 * Annotated rather than inferred, on both counts:
 *  - `role` would widen to `string` and stop matching the parent's
 *    `z.enum(HOUSEHOLD_MEMBER_ROLES)`.
 *  - `dateOfBirth` must be an **optional key**, not a required one holding
 *    `undefined` — only the primary contact has to supply a DOB, so the parent
 *    schema marks it `.optional()`, and a required key does not line up with it.
 * A group's shape has to match the parent's exactly or the field path won't
 * resolve; the error when it doesn't is a wall of candidate paths.
 */
const memberRowDefaults: {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  role: HouseholdMemberRole;
} = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  role: "Spouse",
};

export const emptyMember = () => ({ ...memberRowDefaults });

/**
 * One additional household member.
 *
 * All four relationship roles are offered, **including Child** — the `sfaforms`
 * prototype omits it, and a household with children is the common case for the
 * auto policies these leads become.
 */
export const MemberRowGroup = withFieldGroup({
  defaultValues: memberRowDefaults,
  props: { index: 0, onRemove: () => {} },
  render: function Render({ group, index, onRemove }) {
    return (
      <FormSubPanel
        title={`Member ${index + 1}`}
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-muted-foreground hover:text-foreground"
            onClick={onRemove}
            aria-label={`Remove member ${index + 1}`}
          >
            <X size={14} />
          </Button>
        }
      >
        <FormGrid gap={3}>
          <group.AppField name="firstName">
            {(f) => (
              <f.TextField label="First name" inputClassName="bg-card border-border" />
            )}
          </group.AppField>
          <group.AppField name="lastName">
            {(f) => (
              <f.TextField label="Last name" inputClassName="bg-card border-border" />
            )}
          </group.AppField>
          <group.AppField name="dateOfBirth">
            {(f) => (
              <f.TextField
                label="Date of birth"
                type="date"
                inputClassName="bg-card border-border"
              />
            )}
          </group.AppField>
          <group.AppField name="role">
            {(f) => (
              <f.SelectField
                label="Relationship"
                options={HOUSEHOLD_MEMBER_ROLES}
                triggerClassName="w-full bg-card border-border"
              />
            )}
          </group.AppField>
        </FormGrid>
      </FormSubPanel>
    );
  },
});

interface HouseholdMembersShellProps {
  count: number;
  onAdd: () => void;
  children: React.ReactNode;
}

/** The empty state and add button around the member rows. */
export function HouseholdMembersShell({
  count,
  onAdd,
  children,
}: HouseholdMembersShellProps) {
  return (
    <div className="space-y-3">
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">
          No additional members yet — add a spouse, child, or other driver.
        </p>
      ) : null}
      {children}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={count >= MAX_MEMBERS}
        onClick={onAdd}
      >
        <Plus size={14} />
        Add member
      </Button>
    </div>
  );
}
