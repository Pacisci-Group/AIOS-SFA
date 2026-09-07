import { carrierSlug, type CarrierOption } from "@sfa/shared";
import { Plus, X } from "lucide-react";
import { FormGrid, FormSubPanel } from "@/components/form";
import type { SelectOption } from "@/components/form/fields/SelectField";
import { Button } from "@/components/ui/button";
import { withFieldGroup } from "@/hooks/form";

export const MAX_APPOINTMENTS = 20;

/**
 * The carrier-appointment editor, shared by all three surfaces that collect one
 * (PAC-93): the Super Admin onboarding wizard, the agency owner's first-run
 * setup, and Workspace Settings.
 *
 * Extracted the way `branding-surfaces.tsx` was, and for the same reason — the
 * wizard and the settings page must not drift into two editors with two ideas
 * of what a valid appointment is.
 */

/**
 * Annotated rather than inferred: a bare `""` widens to `string` and stops
 * matching the parent schema, and the booleans must be **optional keys** rather
 * than required ones holding `undefined`, because the API treats an omitted
 * `isPrimary`/`active` as "decide for me". A group's shape has to line up with
 * the parent's exactly or the field path will not resolve, and the error when
 * it does not is a wall of candidate paths.
 */
const appointmentRowDefaults: {
  carrierId: string;
  carrierAgencyCode: string;
  isPrimary?: boolean;
  active?: boolean;
} = {
  carrierId: "",
  carrierAgencyCode: "",
  isPrimary: false,
  active: true,
};

export const emptyAppointment = () => ({ ...appointmentRowDefaults });

/**
 * Carriers as select options.
 *
 * By **id**, not name. Policies store a carrier's display name (see
 * `carrier.ts`), but an appointment stores `carrierId` — the two answer
 * different questions, and an appointment is unique across tenants so it cannot
 * hang off a string anyone can retype.
 */
export function carrierSelectOptions(
  carriers: readonly CarrierOption[],
): SelectOption<string>[] {
  return carriers.map((carrier) => ({
    value: carrier.id,
    label: carrier.name,
  }));
}

/**
 * The carrier to preselect on a fresh row.
 *
 * Allstate is the overwhelmingly common case and sorts first anyway
 * (`displayOrder: 0` in the seed), but match it by slug rather than trusting
 * position. ⚠ A UI convenience with no data meaning — nothing server-side
 * defaults a carrier, and callers must only apply this to a row whose
 * `carrierId` is still empty, never over a deliberate choice.
 */
export function defaultCarrierId(
  carriers: readonly CarrierOption[],
): string | undefined {
  const allstate = carriers.find(
    (carrier) => carrierSlug(carrier.name) === "allstate",
  );
  return (allstate ?? carriers[0])?.id;
}

interface AppointmentRowProps {
  index: number;
  carriers: readonly CarrierOption[];
  onRemove: () => void;
  /** Clears every other row's flag. Omitted in the wizard, which hides it. */
  onPrimaryChosen?: () => void;
  /**
   * The wizard collects the agency's first appointment, where "primary" is
   * decided by construction and "active" is meaningless. Both controls are
   * hidden there rather than shown inert.
   */
  showState?: boolean;
  disabled?: boolean;
}

export const CarrierAppointmentRowGroup = withFieldGroup({
  defaultValues: appointmentRowDefaults,
  props: {
    index: 0,
    carriers: [] as readonly CarrierOption[],
    onRemove: () => {},
    onPrimaryChosen: undefined,
    showState: false,
    disabled: false,
  } as AppointmentRowProps,
  render: function Render({
    group,
    index,
    carriers,
    onRemove,
    onPrimaryChosen,
    showState,
    disabled,
  }) {
    return (
      <FormSubPanel
        title={`Appointment ${index + 1}`}
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-muted-foreground hover:text-foreground"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Remove appointment ${index + 1}`}
          >
            <X size={14} />
          </Button>
        }
      >
        <FormGrid gap={3}>
          <group.AppField name="carrierId">
            {(f) => (
              <f.SelectField
                label="Carrier"
                options={carrierSelectOptions(carriers)}
                placeholder="Choose a carrier"
                disabled={disabled}
                triggerClassName="w-full bg-card border-border"
              />
            )}
          </group.AppField>
          <group.AppField name="carrierAgencyCode">
            {(f) => (
              <f.TextField
                label="Agency code"
                description="As the carrier issued it."
                placeholder="A0B9049"
                autoComplete="off"
                disabled={disabled}
                inputClassName="bg-card border-border font-mono uppercase"
              />
            )}
          </group.AppField>
          {showState ? (
            <>
              <group.AppField name="isPrimary">
                {(f) => (
                  <f.CheckboxField
                    label="Primary appointment"
                    hint="The carrier this agency mainly writes under."
                    disabled={disabled}
                    onChanged={(checked) => {
                      if (checked) onPrimaryChosen?.();
                    }}
                  />
                )}
              </group.AppField>
              <group.AppField name="active">
                {(f) => (
                  <f.CheckboxField
                    label="Active"
                    hint="Turning this off does not free the code for another agency — only removing the appointment does."
                    disabled={disabled}
                  />
                )}
              </group.AppField>
            </>
          ) : null}
        </FormGrid>
      </FormSubPanel>
    );
  },
});

interface AppointmentsShellProps {
  count: number;
  onAdd: () => void;
  emptyMessage?: React.ReactNode;
  disabled?: boolean;
  children: React.ReactNode;
}

/** The empty state and add button around the appointment rows. */
export function CarrierAppointmentsShell({
  count,
  onAdd,
  emptyMessage,
  disabled,
  children,
}: AppointmentsShellProps) {
  return (
    <div className="space-y-3">
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">
          {emptyMessage ??
            "No carrier appointments yet — add the agency code each carrier issued."}
        </p>
      ) : null}
      {children}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || count >= MAX_APPOINTMENTS}
        onClick={onAdd}
      >
        <Plus size={14} />
        Add appointment
      </Button>
    </div>
  );
}
