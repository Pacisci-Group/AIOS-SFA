import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IdCard, Pencil, UserRoundCheck } from "lucide-react";
import { useParams } from "react-router-dom";
import type { EmployeeProfileView } from "@sfa/shared";
import { DataRow, DetailCard } from "@/components/common/DetailCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { getEmployee, hrKeys } from "@/lib/hr-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { cn } from "@/lib/utils";
import { EffectiveRulesSummary } from "../components/EffectiveRulesSummary";
import { hrErrorMessage } from "../settings/hr-error";
import { EmploymentCard } from "./components/EmploymentCard";
import { AssignmentHistory, ChangeLog } from "./components/HistoryCards";
import { RulesEditorPanel } from "./components/RulesEditorPanel";
import {
  ACCOUNT_STATUS_LABELS,
  STATUS_BADGE_CLASS,
  STATUS_LABELS,
  employeeName,
} from "./employee-display";

/**
 * One person's HR record (PAC-162) — `/hr/employees/:userId`.
 *
 * A pending profile opens straight into onboarding: the rules panel *is*
 * the page, because there is nothing else to show yet. An active one shows
 * the facts, the rules in force and the two histories, with the panel
 * opening in place for a change; a terminated one is read-only with a
 * rehire that is the same panel again.
 */
export default function EmployeePage() {
  const { userId = "" } = useParams();
  const queryClient = useQueryClient();
  const [editingRules, setEditingRules] = useState(false);

  const query = useQuery({
    queryKey: hrKeys.employee(userId),
    queryFn: () => getEmployee(userId),
    enabled: userId.length > 0,
  });

  const replace = (next: EmployeeProfileView) => {
    queryClient.setQueryData(hrKeys.employee(userId), next);
  };

  const profile = query.data;
  const title = profile ? employeeName(profile.user) : "Employee";
  const onboarding = profile?.status === "pending";
  const showPanel = Boolean(profile) && (onboarding || editingRules);

  return (
    <SettingsPage
      title={title}
      caption="HR · Employee"
      icon={IdCard}
      backTo={onboarding ? "/hr/onboardings" : "/hr/employees"}
      width="wide"
      action={
        profile && !showPanel ? (
          profile.status === "active" ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditingRules(true)}>
              <Pencil className="size-4" />
              Change rules
            </Button>
          ) : (
            <Button type="button" variant="brand" size="sm" onClick={() => setEditingRules(true)}>
              <UserRoundCheck className="size-4" />
              Rehire
            </Button>
          )
        ) : undefined
      }
    >
      {query.isPending ? (
        <Skeleton className="h-72 w-full rounded-xl" />
      ) : query.isError || !profile ? (
        <p className="text-sm text-destructive">
          {query.error ? hrErrorMessage(query.error) : "Employee profile not found."}
        </p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("border-transparent", STATUS_BADGE_CLASS[profile.status])}>
              {STATUS_LABELS[profile.status]}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {profile.user.email} · {profile.user.roleNames.join(", ") || NOT_AVAILABLE} ·{" "}
              {profile.user.branchName ?? "No branch"} ·{" "}
              {ACCOUNT_STATUS_LABELS[profile.user.accountStatus]}
            </span>
          </div>

          {showPanel ? (
            <RulesEditorPanel
              key={`${profile.id}:${profile.updatedAt}`}
              profile={profile}
              mode={profile.status === "active" ? "change" : "activate"}
              onDone={(next) => {
                replace(next);
                setEditingRules(false);
              }}
              onCancel={() => setEditingRules(false)}
            />
          ) : (
            <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
              <div className="space-y-6">
                <DetailCard title="Rules in force" icon={IdCard}>
                  <EffectiveRulesSummary
                    effective={profile.effective}
                    schedule={profile.schedule}
                    allocations={profile.effectiveAllocations}
                    showCustomPaths
                  />
                </DetailCard>
                <AssignmentHistory profile={profile} />
              </div>
              <div className="space-y-6">
                <EmploymentCard profile={profile} onChanged={replace} />
                <ChangeLog profile={profile} />
              </div>
            </div>
          )}

          {showPanel && !onboarding && (
            <div className="grid gap-6 lg:grid-cols-2">
              <EmploymentCard profile={profile} onChanged={replace} />
              <DetailCard title="Account" icon={IdCard}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <DataRow label="Email" value={profile.user.email} />
                  <DataRow label="Branch" value={profile.user.branchName ?? NOT_AVAILABLE} />
                </div>
              </DetailCard>
            </div>
          )}
          {onboarding && (
            <div className="grid gap-6 lg:grid-cols-2">
              <EmploymentCard profile={profile} onChanged={replace} />
              <ChangeLog profile={profile} />
            </div>
          )}
        </div>
      )}
    </SettingsPage>
  );
}
