import { useQuery } from "@tanstack/react-query";
import { BookOpen, CalendarClock, Wallet } from "lucide-react";
import { DetailCard } from "@/components/common/DetailCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getHrPolicy, hrKeys } from "@/lib/hr-api";
import { hrErrorMessage } from "./hr-error";

interface HrPolicySlotsProps {
  onOpenPolicies: () => void;
}

/**
 * The three slots of the HR Policy (PAC-161): Leave & Attendance, and the two
 * PAC-123 will fill. Assembled by the API on read — there is no record.
 */
export function HrPolicySlots({ onOpenPolicies }: HrPolicySlotsProps) {
  const query = useQuery({ queryKey: hrKeys.hrPolicy, queryFn: getHrPolicy });

  if (query.isPending) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (query.isError) {
    return <p className="text-sm text-destructive">{hrErrorMessage(query.error)}</p>;
  }
  const { leaveAndAttendance } = query.data;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <DetailCard
        title="Leave & Attendance"
        action={
          leaveAndAttendance.status === "configured" ? (
            <Badge variant="success">Configured</Badge>
          ) : (
            <Badge variant="outline">Not set up</Badge>
          )
        }
      >
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2 text-muted-foreground">
            <CalendarClock className="size-4" />
            {leaveAndAttendance.activePolicyCount === 0
              ? "No leave policy. Time off and attendance are not in use."
              : `${leaveAndAttendance.activePolicyCount} active polic${leaveAndAttendance.activePolicyCount === 1 ? "y" : "ies"}.`}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onOpenPolicies}>
            {leaveAndAttendance.activePolicyCount === 0 ? "Add a policy" : "Manage policies"}
          </Button>
        </div>
      </DetailCard>
      <DetailCard title="Compensation" action={<Badge variant="outline">Reserved</Badge>}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Wallet className="size-4" />
          Pay plans and contracts come with the HR & pay epic.
        </p>
      </DetailCard>
      <DetailCard title="Employee Handbook" action={<Badge variant="outline">Reserved</Badge>}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <BookOpen className="size-4" />
          Onboarding documents, signed in the app, come with the same epic.
        </p>
      </DetailCard>
    </div>
  );
}
