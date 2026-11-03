import { CalendarDays } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { AgencyPermission } from "@sfa/shared";
import { usePermissions } from "@/hooks/usePermissions";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { CalendarTab } from "./calendar/CalendarTab";

/**
 * Workspace Settings → HR (PAC-161): the agency holiday calendar. Gated on
 * `agency:hr:admin`, which the Branch Manager (the Office Manager) and the
 * Agency Owner hold by default. Time-off policies (PAC-174) will sit beside
 * the calendar here; until then the page is the calendar and nothing else.
 *
 * A notification deep-links to a proposal with `?proposal=2027` (the older
 * `?tab=calendar` is tolerated and ignored).
 */
export default function HrSettingsPage() {
  const { can } = usePermissions();
  const canWrite = can(AgencyPermission.HrAdmin);
  const [params] = useSearchParams();
  const proposalYear = Number(params.get("proposal"));

  return (
    <SettingsPage
      title="HR"
      caption="Your working week, holidays and closures"
      icon={CalendarDays}
      width="wide"
    >
      <CalendarTab
        canWrite={canWrite}
        proposalYear={Number.isFinite(proposalYear) && proposalYear > 0 ? proposalYear : null}
      />
    </SettingsPage>
  );
}
