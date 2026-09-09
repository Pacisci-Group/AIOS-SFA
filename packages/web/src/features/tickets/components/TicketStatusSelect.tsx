import {
  SERVICE_TICKET_PICKER_STATUSES,
  SERVICE_TICKET_STATUS_LABELS,
  type ServiceTicketStatus,
} from "@sfa/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TICKET_STATUS_CONFIG } from "./ticket-data";

/**
 * The ticket's status pill, editable in place.
 *
 * Deliberately the same control as the Lead Detail status pill
 * (`features/lead/components/lead-inline-selects.tsx`) — a `Select`, not a
 * `DropdownMenu`. The version this replaces was a hand-rolled `<button>` plus an
 * absolutely-positioned `<div>` of `<button>`s: no `combobox`/`listbox` roles,
 * no keyboard type-ahead, no escape-to-close, and no click-away layer, so the
 * menu stayed open when focus moved elsewhere on the page.
 *
 * Read the docblock on `InlineSelect` there before changing the trigger
 * classes — the `data-[size=sm]` and `disabled:` prefixes are both load-bearing.
 */
export function TicketStatusSelect({
  value,
  onChange,
  disabled,
}: {
  value: ServiceTicketStatus;
  onChange: (status: ServiceTicketStatus) => void;
  disabled?: boolean;
}) {
  // A ticket opened from the create form can hold one of the finer states the
  // picker does not offer (`in_progress`, `waiting_on_client`, …). Radix renders
  // nothing for a value with no matching item, so it is added as a disabled
  // entry: the CSR sees what is stored and can move off it, but not back to it.
  const uncatalogued = !(
    SERVICE_TICKET_PICKER_STATUSES as readonly string[]
  ).includes(value);
  const current = TICKET_STATUS_CONFIG[value];

  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as ServiceTicketStatus)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label="Ticket status"
        size="sm"
        className={cn(
          "data-[size=sm]:h-7 w-auto gap-1.5 rounded-full border-0 px-2.5 py-0 text-sm font-semibold shadow-none focus-visible:ring-1 [&>svg]:size-3.5",
          disabled && "cursor-default disabled:opacity-100 [&>svg]:hidden",
          // `current.bg` carries its own `dark:` twin, which is what lets it
          // beat `SelectTrigger`'s built-in `dark:bg-input/30` — see the long
          // note on `TICKET_STATUS_CONFIG`.
          current.bg,
          current.text,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent sideOffset={6}>
        {uncatalogued && (
          <SelectItem value={value} disabled>
            <StatusOption status={value} />
          </SelectItem>
        )}
        {SERVICE_TICKET_PICKER_STATUSES.map((status) => (
          <SelectItem key={status} value={status}>
            <StatusOption status={status} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A menu row, colour-coded to match the trigger.
 *
 * Text and a dot, never a pill: Radix mirrors whatever a `SelectItem` renders
 * into the trigger through `SelectValue`, so a pill here would draw a second
 * pill inside the trigger's own. Same reasoning as `OptionLabel` on the lead
 * selects.
 */
function StatusOption({ status }: { status: ServiceTicketStatus }) {
  const config = TICKET_STATUS_CONFIG[status];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 font-semibold", config.text)}
    >
      <span className={cn("size-2 shrink-0 rounded-full", config.dot)} />
      {SERVICE_TICKET_STATUS_LABELS[status]}
    </span>
  );
}
