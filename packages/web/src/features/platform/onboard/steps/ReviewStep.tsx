import { useStore } from "@tanstack/react-form";
import { FormSection } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { withForm } from "@/hooks/form";
import { MODULE_CATALOG } from "../module-catalog";
import { EMPTY_ONBOARD } from "../onboard-schema";
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
              label="Allstate agency ID"
              value={values.agency.allstateAgencyId || "Not set"}
              mono={!!values.agency.allstateAgencyId}
              muted={!values.agency.allstateAgencyId}
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
