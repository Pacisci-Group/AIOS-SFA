import { AgencyPermission } from "@sfa/shared";
import { Link } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { CarrierAppointmentsEditor } from "@/features/settings/components/CarrierAppointmentsEditor";

/**
 * Phase 2, step 3 — which carriers appointed this agency (PAC-93).
 *
 * ## Why it belongs in the wizard at all
 * A code the operator did not have when they stood the tenant up has to be
 * collected from someone, and the owner is the only person who knows it. It is
 * also the thing that makes an uploaded mailer file find its way to this agency
 * rather than warn on every upload.
 *
 * ## Same shape as the steps beside it
 * Skippable, and saving happens **immediately against the real settings
 * endpoint** rather than being staged until the end — the rule `BrandStep`
 * states. Skipping completes rather than defers, and the same editor lives at
 * `/settings/carriers` forever, so nothing is lost by moving on.
 */
export function CarrierAppointmentsStep() {
  const { can } = usePermissions();

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 md:p-5">
      <CarrierAppointmentsEditor
        canWrite={can(AgencyPermission.CarrierAppointmentsWrite)}
        emptyMessage="Add the agency code each carrier that appointed you issued — it is how mailer files we receive find their way to you."
      />

      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        You can change these at any time in{" "}
        <Link to="/settings/carriers" className="text-primary hover:underline">
          Carrier Appointments
        </Link>
        .
      </p>
    </div>
  );
}
