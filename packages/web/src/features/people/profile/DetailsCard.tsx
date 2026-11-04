import { Pencil, UserRound } from "lucide-react";
import type { PersonProfileView } from "@sfa/shared";
import { DataRow, DetailCard } from "@/components/common/DetailCard";
import { Button } from "@/components/ui/button";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { formatDay } from "@/features/hr/policies/policy-display";

/**
 * The account and the HR facts (PAC-162). Date of birth renders only when
 * the API included it (self or an HR admin) and never as an age; the
 * termination date only once there is one. Edit opens the details drawer.
 */
export function DetailsCard({
  profile,
  onEdit,
}: {
  profile: PersonProfileView;
  onEdit?: () => void;
}) {
  const { user, employment } = profile;
  const hasBirthday = "dateOfBirth" in employment;
  const onboarded = employment.onboardingCompletedAt
    ? `${formatDay(employment.onboardingCompletedAt.slice(0, 10))}${
        employment.onboardingCompletedBy ? ` by ${employment.onboardingCompletedBy.name}` : ""
      }`
    : null;

  return (
    <DetailCard
      title="Details"
      icon={UserRound}
      action={
        onEdit ? (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="size-4" />
            Edit
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {/* `break-all` inherits to the value: a long address wraps instead of
            running under the next column. */}
        <DataRow label="Email" value={user.email} className="break-all" />
        <DataRow label="Phone" value={user.phone ?? NOT_AVAILABLE} />
        <DataRow label="Branch" value={user.branch?.name ?? "Unassigned"} />
        <DataRow label="Role" value={user.roles.map((role) => role.name).join(", ") || NOT_AVAILABLE} />
        <DataRow
          label="Hire date"
          value={employment.hireDate ? formatDay(employment.hireDate) : NOT_AVAILABLE}
        />
        {hasBirthday && (
          <DataRow
            label="Date of birth"
            value={
              employment.dateOfBirth
                ? `${formatDay(employment.dateOfBirth)} · ${
                    employment.showBirthday ? "shown on the calendar" : "hidden"
                  }`
                : NOT_AVAILABLE
            }
          />
        )}
        {employment.terminationDate && (
          <DataRow label="Termination date" value={formatDay(employment.terminationDate)} />
        )}
        <DataRow label="Onboarded" value={onboarded ?? "Not yet"} />
      </div>
    </DetailCard>
  );
}
