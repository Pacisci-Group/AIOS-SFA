import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarHeart, IdCard } from "lucide-react";
import { toast } from "sonner";
import { AgencyPermission, ModuleKey, modulePermission } from "@sfa/shared";
import { DataRow, DetailCard } from "@/components/common/DetailCard";
import { FormError } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { usePermissions } from "@/hooks/usePermissions";
import { ApiError } from "@/lib/api-client";
import { agencyTodayYmd } from "@/lib/dates";
import { getMyHrProfile, hrKeys, updateMyHrProfile } from "@/lib/hr-api";
import { formatDay, formatMonthDay } from "../employees/employee-display";
import { hrErrorMessage } from "../settings/hr-error";
import { EffectiveRulesSummary } from "./EffectiveRulesSummary";

/**
 * The signed-in person's own HR record on `/settings/profile` (PAC-162):
 * their rules and week, read-only, and the two birthday fields they own.
 * Hidden without `hr:read`; "not set up yet" on a 404 (a platform admin, or
 * a user the migration has not reached). PAC-165's My Time Off reuses the
 * summary.
 */
export function HrProfileCard() {
  const { can } = usePermissions();
  const enabled = can(modulePermission(ModuleKey.Hr, "read"));
  const query = useQuery({
    queryKey: hrKeys.myProfile,
    queryFn: getMyHrProfile,
    enabled,
    retry: false,
  });
  if (!enabled) return null;
  if (query.isPending) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (query.isError) {
    const err = query.error;
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
      return (
        <DetailCard title="Employment" icon={IdCard}>
          <p className="text-sm text-muted-foreground">
            Your HR profile is not set up yet.
            {can(AgencyPermission.HrAdmin) ? " Open HR → Onboardings to set it up." : ""}
          </p>
        </DetailCard>
      );
    }
    return (
      <DetailCard title="Employment" icon={IdCard}>
        <p className="text-sm text-destructive">{hrErrorMessage(err)}</p>
      </DetailCard>
    );
  }
  const profile = query.data;
  return (
    <>
      <DetailCard title="Employment" icon={IdCard}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <DataRow label="Hire date" value={formatDay(profile.hireDate)} />
            <DataRow label="Work anniversary" value={formatMonthDay(profile.workAnniversary)} />
          </div>
          {profile.status === "pending" ? (
            <p className="text-sm text-muted-foreground">
              Your leave policy has not been set yet — HR will pick it when they onboard you.
            </p>
          ) : (
            <EffectiveRulesSummary
              effective={profile.effective}
              schedule={profile.schedule}
              allocations={profile.effectiveAllocations}
            />
          )}
        </div>
      </DetailCard>
      <BirthdayCard
        key={`${profile.dateOfBirth ?? ""}:${String(profile.showBirthday)}`}
        dateOfBirth={profile.dateOfBirth}
        showBirthday={profile.showBirthday}
      />
    </>
  );
}

function BirthdayCard({
  dateOfBirth,
  showBirthday,
}: {
  dateOfBirth: string | null;
  showBirthday: boolean;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dob, setDob] = useState(dateOfBirth ?? "");
  const [show, setShow] = useState(showBirthday);
  const [error, setError] = useState<string | null>(null);
  const dirty = dob !== (dateOfBirth ?? "") || show !== showBirthday;

  const save = useMutation({
    mutationFn: () =>
      updateMyHrProfile({
        ...(dob !== (dateOfBirth ?? "") ? { dateOfBirth: dob || null } : {}),
        ...(show !== showBirthday ? { showBirthday: show } : {}),
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(hrKeys.myProfile, next);
      setError(null);
      toast.success("Birthday saved.");
    },
    onError: (err) => setError(hrErrorMessage(err)),
  });

  return (
    <DetailCard title="Birthday" icon={CalendarHeart}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Only you and the HR admins can see the date. With the toggle on, the agency calendar
          shows the month and day — never the year or your age.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="me-dob">Date of birth</Label>
            <Input
              id="me-dob"
              type="date"
              max={agencyTodayYmd(user?.timeZone)}
              value={dob}
              className="bg-card border-border"
              onChange={(e) => setDob(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 sm:self-end sm:pb-2">
            <Checkbox
              id="me-show-birthday"
              checked={show}
              onCheckedChange={(checked) => setShow(checked === true)}
            />
            <Label htmlFor="me-show-birthday" className="font-normal">
              Show my birthday on the agency calendar
            </Label>
          </div>
        </div>
        <FormError>{error}</FormError>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="brand"
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </DetailCard>
  );
}
