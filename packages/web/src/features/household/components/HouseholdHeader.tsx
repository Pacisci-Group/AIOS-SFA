import { ChevronRight, FileText, Plus, Ticket, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DisabledHint } from "@/components/common/DisabledHint";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";

interface HouseholdHeaderProps {
  householdName: string;
  /** Record label (`HH-002614`), shown under the name. */
  recordLabel?: string;
  /** Opens the New Service Ticket dialog. */
  onNewTicket?: () => void;
  /** Opens the Add Household Member dialog. */
  onAddMember?: () => void;
  /** Opens the Start Quote dialog (lead → quote recap). */
  onStartQuote?: () => void;
  /**
   * Why an action is unavailable, for the actions that have no handler.
   *
   * **An action without a handler renders disabled**, and this is the tooltip
   * saying why. Both halves matter: these buttons used to render fully live and
   * silently do nothing on the demo household, which reads as a broken button
   * rather than an unavailable one — there is no console error to find, because
   * nothing went wrong.
   */
  disabledReasons?: {
    addMember?: string;
    newTicket?: string;
    startQuote?: string;
  };
}

/** Shown when an action is unavailable and the caller offered no reason. */
const DEFAULT_DISABLED_REASON = "Not available on this record.";

/**
 * The Household Details page header.
 *
 * Built to match `LeadDetailHeader`: mobile nav, a breadcrumb that ends at the
 * section rather than repeating the record's name, the name as a real `h1`, and
 * the page's actions on the right through `Button`.
 *
 * The mockup's search box and notification bell are deliberately absent — same
 * call as on Lead Detail. Neither had a backing feature: the input filtered
 * nothing and the bell rendered a permanent unread dot over an empty menu, so
 * both read as broken rather than forthcoming. Global search is PAC-42.
 */
export function HouseholdHeader({
  householdName,
  recordLabel,
  onNewTicket,
  onAddMember,
  onStartQuote,
  disabledReasons = {},
}: HouseholdHeaderProps) {
  const actions: {
    label: string;
    icon: LucideIcon;
    primary?: boolean;
    onClick?: () => void;
    reason?: string;
  }[] = [
    {
      label: "Policy",
      icon: FileText,
      // No handler anywhere yet — this one is still mockup.
      reason: "Adding a policy from here isn't built yet.",
    },
    {
      label: "Member",
      icon: User,
      onClick: onAddMember,
      reason: disabledReasons.addMember,
    },
    {
      label: "Ticket",
      icon: Ticket,
      onClick: onNewTicket,
      reason: disabledReasons.newTicket,
    },
    {
      label: "Start quote",
      icon: Plus,
      primary: true,
      onClick: onStartQuote,
      reason: disabledReasons.startQuote,
    },
  ];

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-4 md:gap-4 md:px-6">
      <div className="flex min-w-0 items-center gap-2 md:gap-3">
        <MobileNav className="-ml-1" />
        {/*
          "Clients" is deliberately *not* a link. There is no clients list page
          yet (PAC-57 — see the note in `components/layout/nav-items.ts`), and
          the nearest thing, the Service Dashboard, is a different screen; a
          crumb that says Clients and lands somewhere else is worse than one
          that does not move.
        */}
        <nav
          aria-label="Breadcrumb"
          className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex"
        >
          <span>Clients</span>
          <ChevronRight aria-hidden className="size-4" />
        </nav>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight text-card-foreground">
            {householdName}
          </h1>
          {recordLabel && (
            <p className="text-xs font-medium uppercase tracking-wide tabular-nums text-muted-foreground">
              {recordLabel}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {actions.map(({ label, icon: Icon, primary, onClick, reason }) => {
          // The handler IS the availability signal — there is no separate
          // `disabled` prop to fall out of sync with it.
          const disabled = !onClick;
          return (
            // The hint lives on the wrapper, not on the button: `Button` carries
            // `disabled:pointer-events-none`, so a `title` on a disabled one is
            // never hovered and never shown. See `DisabledHint`.
            <DisabledHint
              key={label}
              hint={disabled ? (reason ?? DEFAULT_DISABLED_REASON) : undefined}
            >
              <Button
                size="sm"
                variant={primary ? "default" : "outline"}
                onClick={onClick}
                disabled={disabled}
              >
                <Icon />
                {label}
              </Button>
            </DisabledHint>
          );
        })}
      </div>
    </header>
  );
}
