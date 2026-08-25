import type { LeadTemperature, NormalizedLeadSource } from "@sfa/shared";
import {
  LEAD_SOURCE_NONE,
  LEAD_STATUSES,
  LEAD_TEMPERATURE_OPTIONS,
  ModuleKey,
  SELECTABLE_LEAD_SOURCE_OPTIONS,
} from "@sfa/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import {
  statusBadgeClass,
  statusTextClass,
  temperatureDot,
  temperatureText,
} from "./lead-display";

/**
 * The inline status / temperature / source pills on the Lead Detail page
 * (PAC-38).
 *
 * `Select` rather than `DropdownMenu` for all three. A dropdown menu is a menu
 * of *commands*: no `value`/`onValueChange` contract, no notion of a selected
 * item, no `SelectValue` — it would need a hand-rolled check mark and trigger
 * label, and would lose the `combobox`/`listbox` roles and keyboard type-ahead
 * that make these usable without a mouse.
 *
 * Each one degrades to a plain, non-interactive pill without `leads:write`,
 * matching the house style of self-gating action components (`QuoteRecapAction`,
 * `SoldDealAction`) rather than making every caller check first.
 */

interface InlineSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label: string;
  triggerClassName: string;
  children: React.ReactNode;
}

function InlineSelect({
  value,
  onChange,
  disabled,
  label,
  triggerClassName,
  children,
}: InlineSelectProps) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={label}
        size="sm"
        className={cn(
          // `data-[size=sm]:h-7` rather than a bare `h-7`: the primitive sets
          // its height through the same data-attribute variant, which would
          // otherwise win regardless of order.
          "data-[size=sm]:h-7 w-auto gap-1.5 rounded-full border-0 px-2.5 py-0 text-sm font-semibold shadow-none focus-visible:ring-1 [&>svg]:size-3.5",
          // `disabled:` prefixed, not bare `opacity-100`. The primitive carries
          // `disabled:opacity-50`; an unprefixed utility does not conflict with
          // it, so the pill used to dim to half and drop its chevron for the
          // duration of every save.
          disabled &&
            "disabled:opacity-100 [&>svg]:hidden cursor-default",
          triggerClassName,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      {/*
        `sideOffset` clears the pill so the menu reads as attached to it rather
        than overlapping. The drop-below-at-trigger-width behaviour itself now
        comes from the primitive's own defaults (`popper` / `align="start"`).
      */}
      <SelectContent sideOffset={6}>{children}</SelectContent>
    </Select>
  );
}

/** Read-only pill, for when the value is not one a producer may select. */
function StaticPill({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A menu row, colour-coded to match the trigger it came from.
 *
 * ⚠ Whatever a `SelectItem` renders, Radix mirrors into the trigger through
 * `SelectValue` — shadcn's item puts `children` inside `ItemText`. So this is
 * deliberately **text and an optional dot, never a pill**: a pill here draws a
 * second pill inside the trigger's own, and a dot here duplicates the trigger's
 * adornment. Colouring the label is the one treatment that reads correctly in
 * both places, and it is what makes the open menu look like the status
 * vocabulary rather than a list of anonymous rows.
 */
function OptionLabel({
  className,
  dot,
  children,
}: {
  className: string;
  dot?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-semibold", className)}>
      {dot && <span className={cn("size-2 shrink-0 rounded-full", dot)} />}
      {children}
    </span>
  );
}

export function LeadStatusSelect({
  value,
  onChange,
  pending,
}: {
  value: string;
  onChange: (status: string) => void;
  pending?: boolean;
}) {
  const { canWrite } = usePermissions();
  const editable = canWrite(ModuleKey.Leads);

  // A migrated lead can hold a label outside the canonical ten. Radix renders
  // nothing for a value with no matching item, so it is added as a disabled
  // entry — the producer sees what is stored and can move off it, but cannot
  // pick it again.
  const uncatalogued = !(LEAD_STATUSES as readonly string[]).includes(value);

  if (!editable) {
    return <StaticPill className={statusBadgeClass(value)}>{value}</StaticPill>;
  }

  return (
    <InlineSelect
      label="Lead status"
      value={value}
      onChange={onChange}
      disabled={pending}
      triggerClassName={statusBadgeClass(value)}
    >
      {uncatalogued && (
        <SelectItem value={value} disabled>
          <OptionLabel className={statusTextClass(value)}>{value}</OptionLabel>
        </SelectItem>
      )}
      {LEAD_STATUSES.map((status) => (
        <SelectItem key={status} value={status}>
          <OptionLabel className={statusTextClass(status)}>{status}</OptionLabel>
        </SelectItem>
      ))}
    </InlineSelect>
  );
}

export function LeadTemperatureSelect({
  value,
  onChange,
  pending,
}: {
  value: LeadTemperature;
  onChange: (temperature: LeadTemperature) => void;
  pending?: boolean;
}) {
  const { canWrite } = usePermissions();
  const editable = canWrite(ModuleKey.Leads);

  if (!editable) {
    return (
      <StaticPill className={cn("bg-muted", temperatureText[value])}>
        <span className={cn("size-2 rounded-full", temperatureDot[value])} />
        {value}
      </StaticPill>
    );
  }

  return (
    <InlineSelect
      label="Lead temperature"
      value={value}
      onChange={(next) => onChange(next as LeadTemperature)}
      disabled={pending}
      triggerClassName={cn("bg-muted", temperatureText[value])}
    >
      {/*
       * `Unknown` is the display state of a lead nobody has assessed, not a
       * choice — the API rejects it on write. Shown disabled so the current
       * value still renders while the producer moves off it.
       */}
      {value === "Unknown" && (
        <SelectItem value="Unknown" disabled>
          <OptionLabel className={temperatureText.Unknown} dot={temperatureDot.Unknown}>
            Unknown
          </OptionLabel>
        </SelectItem>
      )}
      {LEAD_TEMPERATURE_OPTIONS.map((temperature) => (
        <SelectItem key={temperature} value={temperature}>
          <OptionLabel
            className={temperatureText[temperature]}
            dot={temperatureDot[temperature]}
          >
            {temperature}
          </OptionLabel>
        </SelectItem>
      ))}
    </InlineSelect>
  );
}

/**
 * Lead source.
 *
 * This is the control the whole story turns on: leads that arrive through a
 * public share link (PAC-37) carry no source at all, and without an editor they
 * could never be corrected. Hence the explicit "No source" option — a producer
 * must be able to unset a wrong answer as well as set a right one.
 */
export function LeadSourceSelect({
  value,
  onChange,
  pending,
}: {
  value: NormalizedLeadSource;
  onChange: (code: string) => void;
  pending?: boolean;
}) {
  const { canWrite } = usePermissions();
  const editable = canWrite(ModuleKey.Leads);

  const selectable = SELECTABLE_LEAD_SOURCE_OPTIONS.find(
    (option) => option.code === value.code,
  );

  // Three cases the stored value can be in:
  //  - a selectable code            → normal round-trip
  //  - unset (share link / cleared) → the `__none__` sentinel
  //  - a label with no usable code  → shown, but not re-selectable
  //
  // `normalizeLeadSource` renders an unset source as the label `Unknown` (which
  // is what the Leads list shows), so an empty label alone doesn't identify the
  // state — a share-link lead arrives as `{ code: null, label: "Unknown" }`.
  // The detail page says "No source" instead, because here it is an editable
  // field and the producer needs to know there is something to fix.
  const unset = !value.code && (!value.label || value.label === "Unknown");
  const current = selectable
    ? selectable.code
    : unset
      ? LEAD_SOURCE_NONE
      : "__stored__";

  if (!editable) {
    return (
      <span className="text-sm text-muted-foreground">
        {unset ? "No source" : value.label}
      </span>
    );
  }

  return (
    <InlineSelect
      label="Lead source"
      value={current}
      onChange={onChange}
      disabled={pending}
      triggerClassName={cn(
        "font-medium",
        unset
          ? "bg-amber-500/15 text-amber-700 dark:text-amber-500"
          : "bg-muted text-foreground",
      )}
    >
      {current === "__stored__" && (
        <SelectItem value="__stored__" disabled>
          {value.label}
        </SelectItem>
      )}
      <SelectItem value={LEAD_SOURCE_NONE}>No source</SelectItem>
      {SELECTABLE_LEAD_SOURCE_OPTIONS.map((option) => (
        <SelectItem key={option.code} value={option.code}>
          {option.label}
        </SelectItem>
      ))}
    </InlineSelect>
  );
}
