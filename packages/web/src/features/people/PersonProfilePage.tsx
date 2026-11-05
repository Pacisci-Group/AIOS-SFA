import { useEffect, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Contact } from "lucide-react";
import {
  AgencyPermission,
  ModuleKey,
  type PersonProfileView,
  type PersonTimeOffPolicyView,
} from "@sfa/shared";
import { UserAvatar } from "@/components/common/UserAvatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { usePermissions } from "@/hooks/usePermissions";
import { ApiError } from "@/lib/api-client";
import { getPersonProfile, peopleKeys } from "@/lib/people-api";
import type { AgencyUser } from "@/lib/users-api";
import { cn } from "@/lib/utils";
import { PersonRowMenu } from "./PersonRowMenu";
import { AVATAR_FALLBACK_CLASS, STATUS_BADGE } from "./person-display";
import { DetailsCard } from "./profile/DetailsCard";
import { OnboardingCard } from "./profile/OnboardingCard";
import { RoleCard } from "./profile/RoleCard";
import { ScheduleCard } from "./profile/ScheduleCard";
import { TimeOffCard } from "./profile/TimeOffCard";
import { RequestSheet } from "@/features/time-off/request/RequestSheet";
import { AddToPolicySheet } from "./sheets/AddToPolicySheet";
import { AdjustBalanceSheet } from "./sheets/AdjustBalanceSheet";
import { CompleteOnboardingSheet } from "./sheets/CompleteOnboardingSheet";
import { EditDetailsSheet } from "./sheets/EditDetailsSheet";

type Sheet = "details" | "onboarding" | "policy" | "record";

/**
 * A person's profile (`/people/:userId`, PAC-162): the account, the HR
 * facts, their time off policies with balances, their week, their role —
 * each section present only when the API included it for this viewer
 * (the person themself, or an `agency:users:read` holder; time off and
 * schedule for self with `hr:read` or an HR admin).
 *
 * ## Quiet by design
 *
 * Asad: "the data shouldn't be bombarded on the page." A 60/40 split of
 * five cards, every write behind a drawer, and the Onboarding card a single
 * call to action while the profile is pending. `?onboard=1` (the row menu's
 * "Complete onboarding…") opens that drawer on arrival.
 *
 * Ungated at the router because anyone may open their own; a viewer who is
 * neither the person nor a directory reader is sent home before the request
 * (the API would 403 anyway).
 */
export default function PersonProfilePage() {
  const { userId = "" } = useParams<{ userId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: viewer } = useAuth();
  const { can, canWrite } = usePermissions();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [adjusting, setAdjusting] = useState<PersonTimeOffPolicyView | null>(null);

  const isSelf = viewer?.id === userId;
  const mayView = isSelf || can(AgencyPermission.UsersRead);
  const hrAdmin = can(AgencyPermission.HrAdmin);
  // Time off (PAC-165): a reviewer sees the person's requests; with the
  // directory permission as well they may record time off for them — never
  // for themself, whose own time off is always a request.
  const reviewer = canWrite(ModuleKey.Hr);
  const mayRecord = reviewer && can(AgencyPermission.UsersRead) && !isSelf;

  const profile = useQuery({
    queryKey: peopleKeys.profile(userId),
    queryFn: () => getPersonProfile(userId),
    enabled: mayView && !!userId,
    retry: false,
  });
  const data = profile.data;
  const pending = data?.user.status === "pending_onboarding" || data?.user.status === "invited";
  const mayOnboard = hrAdmin && !!data && data.employment.status === "pending" && !data.user.deactivatedAt;

  // The row menu's "Complete onboarding…" lands here with `?onboard=1`.
  useEffect(() => {
    if (searchParams.get("onboard") && mayOnboard) {
      setSheet("onboarding");
      setSearchParams((next) => {
        next.delete("onboard");
        return next;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams, mayOnboard]);

  if (!mayView) return <Navigate to="/" replace />;

  const name = data?.user.name ?? "";
  const status = data ? STATUS_BADGE[data.user.status] : null;

  return (
    <SettingsPage
      title={name || "Person"}
      caption={data ? data.user.roles.map((role) => role.name).join(" · ") || "No role" : " "}
      icon={Contact}
      width="wide"
      backTo={can(AgencyPermission.UsersRead) ? "/people" : "/"}
      action={data ? <PersonRowMenu user={toAgencyUser(data)} onProfile /> : undefined}
    >
      {profile.isError && (
        <Alert variant="destructive" className="mb-5">
          <AlertCircle />
          <AlertDescription>
            {profile.error instanceof ApiError && profile.error.status === 404
              ? "That person is not in this agency."
              : (profile.error as Error).message}
          </AlertDescription>
        </Alert>
      )}

      {profile.isPending && !profile.isError && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Skeleton className="size-16 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          </div>
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      )}

      {data && status && (
        <div className="space-y-6">
          <header className="flex flex-wrap items-center gap-4">
            <UserAvatar
              name={name}
              avatarUrl={data.user.avatarUrl}
              className="size-16"
              fallbackClassName={cn(AVATAR_FALLBACK_CLASS, "text-lg")}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">
                  {name}
                </h2>
                <Badge size="sm" className={cn("font-semibold", status.className)}>
                  {status.label}
                </Badge>
                {pending && isSelf && (
                  <span className="text-xs text-muted-foreground">
                    HR completes your onboarding; nothing is blocked meanwhile.
                  </span>
                )}
              </div>
              <p className="truncate text-sm text-muted-foreground">
                {[data.user.email, data.user.phone, data.user.branch?.name]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </header>

          <div className="grid gap-6 lg:grid-cols-5">
            <div className="space-y-6 lg:col-span-3">
              <DetailsCard
                profile={data}
                onEdit={hrAdmin ? () => setSheet("details") : undefined}
              />
              {data.timeOff && (
                <TimeOffCard
                  profile={data}
                  canManage={hrAdmin}
                  onAdd={() => setSheet("policy")}
                  onAdjust={hrAdmin ? setAdjusting : undefined}
                  onRecord={
                    mayRecord && data.user.isActive ? () => setSheet("record") : undefined
                  }
                  requestsHref={
                    isSelf
                      ? "/time-off"
                      : reviewer
                        ? `/time-off?tab=team&employee=${data.user.id}`
                        : undefined
                  }
                />
              )}
            </div>
            <div className="space-y-6 lg:col-span-2">
              {mayOnboard && <OnboardingCard onStart={() => setSheet("onboarding")} />}
              {data.schedule && <ScheduleCard schedule={data.schedule} />}
              <RoleCard
                profile={data}
                canUpdatePermissions={can(AgencyPermission.RolesRead)}
              />
            </div>
          </div>
        </div>
      )}

      {data && sheet === "details" && (
        <EditDetailsSheet key={data.user.id} profile={data} onClose={() => setSheet(null)} />
      )}
      {data && sheet === "onboarding" && mayOnboard && (
        <CompleteOnboardingSheet profile={data} onClose={() => setSheet(null)} />
      )}
      {data && sheet === "policy" && (
        <AddToPolicySheet profile={data} onClose={() => setSheet(null)} />
      )}
      {data && adjusting && (
        <AdjustBalanceSheet
          key={adjusting.id}
          profile={data}
          policy={adjusting}
          onClose={() => setAdjusting(null)}
        />
      )}
      {data && sheet === "record" && mayRecord && (
        <RequestSheet
          key={`record-${data.user.id}`}
          mode="record"
          employeeId={data.user.id}
          // The profile already holds what the picker needs about this person.
          people={[
            {
              id: data.user.id,
              name: data.user.name,
              branchName: data.user.branch?.name ?? null,
              policies: (data.timeOff?.policies ?? []).map((policy) => ({
                id: policy.id,
                name: policy.name,
                timeOffType: policy.timeOff.timeOffType,
                unlimited: policy.timeOff.accrualType === "unlimited",
              })),
            },
          ]}
          onClose={() => setSheet(null)}
        />
      )}
    </SettingsPage>
  );
}

/** The row menu renders from a directory row; the profile has the same facts. */
function toAgencyUser(profile: PersonProfileView): AgencyUser {
  return {
    _id: profile.user.id,
    agencyId: null,
    branchId: profile.user.branch?.id ?? null,
    email: profile.user.email,
    firstName: profile.user.firstName ?? undefined,
    lastName: profile.user.lastName ?? undefined,
    phone: profile.user.phone ?? undefined,
    availability: profile.user.availability,
    isActive: profile.user.isActive,
    deactivatedAt: profile.user.deactivatedAt,
    status: profile.user.status,
    avatarUrl: profile.user.avatarUrl,
    isPlatformAdmin: false,
    roleIds: profile.user.roles.map((role) => ({ _id: role.id, name: role.name, slug: "" })),
  };
}
