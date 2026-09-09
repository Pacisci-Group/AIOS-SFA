import { useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import type { CarrierOption } from "@sfa/shared";
import { FormSection } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { withForm } from "@/hooks/form";
import { MODULE_CATALOG } from "../module-catalog";
import { EMPTY_ONBOARD } from "../onboard-schema";
import { getPlatformCarriers, platformCarriersKey } from "@/lib/carriers-api";
import { ONBOARD_STEPS, type OnboardStepId } from "../onboard-steps";

/**
 * Step 5 — one last look before anything is written.
 *
 * Worth its own step because the thing being created is a whole tenant with an
 * email going out to a real person at the end of it, and the four decisions that
 * produced it are on four screens the operator can no longer see.
 *
 * Each section links back to the step that owns it, so a typo is two clicks from
 * being fixed rather than four Backs.
 */
export const ReviewStep = withForm({
  defaultValues: EMPTY_ONBOARD,
  props: { onEdit: (_index: number) => {} },
  render: function Render({ form, onEdit }) {
    const values = useStore(form.store, (s) => s.values);
    // Cached by the Agency step's own query — the appointments are stored by
    // carrier id, and this is the only place that turns them back into names.
    const { data: carriers = [] } = useQuery({
      queryKey: platformCarriersKey,
      queryFn: getPlatformCarriers,
      staleTime: Infinity,
    });
    const address = values.branch.address;
    const addressLine = [
      address.street,
      address.city,
      address.state,
      address.zip,
    ]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(", ");

    const editButton = (id: OnboardStepId) => (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onEdit(ONBOARD_STEPS.findIndex((s) => s.id === id))}
      >
        Edit
      </Button>
    );

    return (
      <div className="space-y-4">
        <FormSection title="Agency" titleAs="h3" action={editButton("agency")}>
          <dl className="space-y-2 text-sm">
            <Row label="Name" value={values.agency.name} />
            <Row label="Slug" value={values.agency.slug} mono />
            <Row
              label="Mailer ticker"
              value={values.agency.ticker || "Not set"}
              mono={!!values.agency.ticker}
              muted={!values.agency.ticker}
            />
            <Row
              label="NPN"
              value={values.agency.npn || "Not set"}
              mono={!!values.agency.npn}
              muted={!values.agency.npn}
            />
            <AppointmentRows
              appointments={values.agency.carrierAppointments}
              carriers={carriers}
            />
          </dl>
        </FormSection>

        <FormSection
          title="First branch"
          titleAs="h3"
          action={editButton("branch")}
        >
          <dl className="space-y-2 text-sm">
            <Row label="Name" value={values.branch.name} />
            <Row
              label="Address"
              value={addressLine || "Not set"}
              muted={!addressLine}
            />
          </dl>
        </FormSection>

        <FormSection
          title="Modules"
          titleAs="h3"
          action={editButton("modules")}
        >
          {values.modules.length ? (
            <div className="flex flex-wrap gap-1.5">
              {values.modules.map((key) => (
                <Badge key={key} size="sm" variant="secondary">
                  {MODULE_CATALOG[key].label}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No modules enabled — the owner will sign in to an app with no
              pages. You can switch them on afterwards.
            </p>
          )}
        </FormSection>

        <FormSection title="Owner" titleAs="h3" action={editButton("owner")}>
          <dl className="space-y-2 text-sm">
            <Row
              label="Name"
              value={`${values.owner.firstName} ${values.owner.lastName}`.trim()}
            />
            <Row label="Email" value={values.owner.email} />
          </dl>
          <p className="text-xs text-muted-foreground">
            They will be emailed a link to set a password. The link expires in
            seven days and can be resent.
          </p>
        </FormSection>
      </div>
    );
  },
});

function Row({
  label,
  value,
  mono,
  muted,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={
          (mono ? "font-mono " : "") +
          (muted ? "text-muted-foreground" : "text-foreground")
        }
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * One row per appointment the operator entered.
 *
 * A row with a carrier and no code is shown as such rather than hidden: the
 * operator chose that carrier, and "the owner will supply the code" is exactly
 * what they should be confirming here.
 */
function AppointmentRows({
  appointments,
  carriers,
}: {
  appointments: { carrierId: string; carrierAgencyCode: string }[];
  carriers: readonly CarrierOption[];
}) {
  const named = appointments.filter((row) => row.carrierId);
  if (named.length === 0) {
    return <Row label="Carrier appointments" value="None" muted />;
  }

  return (
    <>
      {named.map((row, index) => {
        const carrier = carriers.find((option) => option.id === row.carrierId);
        const code = row.carrierAgencyCode.trim();
        return (
          <Row
            key={`${row.carrierId}-${index}`}
            label={index === 0 ? "Carrier appointments" : ""}
            value={
              code
                ? `${carrier?.name ?? "Carrier"} — ${code}`
                : `${carrier?.name ?? "Carrier"} — code to be added by the owner`
            }
            mono={!!code}
            muted={!code}
          />
        );
      })}
    </>
  );
}
