import { BadgeCheck } from "lucide-react";
import { AgencyPermission } from "@sfa/shared";
import { DetailCard } from "@/components/common/DetailCard";
import { usePermissions } from "@/hooks/usePermissions";
import { CarrierAppointmentsEditor } from "./components/CarrierAppointmentsEditor";
import { SettingsPage } from "./SettingsPage";

/**
 * Workspace Settings → Carrier Appointments (PAC-93).
 *
 * The agency owns this, not the platform: an operator records what they know
 * while standing the tenant up, and everything after that — a new carrier, a
 * corrected code, a lapsed appointment — is the agency's own to change.
 *
 * Gated on `agency:carrier_appointments:read` like the five sections beside it,
 * with the write controls additionally hidden without `:write`. The API is the
 * enforcement either way; this just avoids offering a button that 403s.
 */
export default function CarrierAppointmentsPage() {
  const { can } = usePermissions();

  return (
    <SettingsPage
      title="Carrier Appointments"
      caption="The agency code each carrier issued you"
      icon={BadgeCheck}
    >
      <DetailCard
        title="Appointments"
        subheading="Used to match uploaded mailer files to your agency."
      >
        <CarrierAppointmentsEditor
          canWrite={can(AgencyPermission.CarrierAppointmentsWrite)}
          emptyMessage="No carrier appointments yet. Add the agency code each carrier that appointed you issued — it is how your mailer files find their way to you."
        />
      </DetailCard>
    </SettingsPage>
  );
}
