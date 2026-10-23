import { CalendarDays } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { AgencyPermission } from "@sfa/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { CalendarTab } from "./calendar/CalendarTab";
import { HrPolicySlots } from "./HrPolicySlots";
import { PoliciesTab } from "./policies/PoliciesTab";
import { SchedulesTab } from "./schedules/SchedulesTab";

const TABS = ["calendar", "policies", "schedules", "hr-policy"] as const;
type Tab = (typeof TABS)[number];

/**
 * Workspace Settings → HR (PAC-161): the agency calendar, the leave policies
 * and the HR Policy slots. Gated on `agency:hr:admin`, which the Branch
 * Manager (the Office Manager) and the Agency Owner hold by default.
 *
 * The tab rides in the URL so a notification can deep-link to the calendar
 * with its proposal (`?tab=calendar&proposal=2027`).
 */
export default function HrSettingsPage() {
  const { can } = usePermissions();
  const canWrite = can(AgencyPermission.HrAdmin);
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(requested ?? "")
    ? (requested as Tab)
    : "calendar";
  const proposalYear = Number(params.get("proposal"));

  const setTab = (next: string) => {
    const copy = new URLSearchParams(params);
    copy.set("tab", next);
    copy.delete("proposal");
    setParams(copy, { replace: true });
  };

  return (
    <SettingsPage title="HR" caption="Calendar and leave rules" icon={CalendarDays} width="wide">
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="policies">Leave policies</TabsTrigger>
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
          <TabsTrigger value="hr-policy">HR policy</TabsTrigger>
        </TabsList>
        <TabsContent value="calendar">
          <CalendarTab
            canWrite={canWrite}
            proposalYear={Number.isFinite(proposalYear) && proposalYear > 0 ? proposalYear : null}
          />
        </TabsContent>
        <TabsContent value="policies">
          <PoliciesTab canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="schedules">
          <SchedulesTab canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="hr-policy">
          <HrPolicySlots onOpenPolicies={() => setTab("policies")} />
        </TabsContent>
      </Tabs>
    </SettingsPage>
  );
}
