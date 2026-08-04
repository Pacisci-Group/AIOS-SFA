import type { LeadDetail, LeadTemperature } from "@sfa/shared";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { QuoteRecapAction } from "@/components/leads/QuoteRecapAction";
import { SoldDealAction } from "@/components/leads/SoldDealAction";
import {
  LeadStatusSelect,
  LeadTemperatureSelect,
} from "./lead-inline-selects";

interface LeadDetailHeaderProps {
  lead: LeadDetail;
  onStatusChange: (status: string) => void;
  onTemperatureChange: (temperature: LeadTemperature) => void;
  pending: boolean;
}

/**
 * Breadcrumb, name, the two editable pills, and the pipeline actions.
 *
 * Both actions are the **shared self-gating components**, not hand-rolled links.
 * The previous markup built the Quote Recap link from `newQuoteRecapRoute`
 * directly, which skipped the `quote_recaps:write` check `QuoteRecapAction`
 * performs — so a producer without that permission saw a button that bounced
 * them straight back from `/quote-recaps/new`.
 *
 * The mockup's "Send to Independent", bell and search are deliberately absent:
 * none has a backing feature (PAC-35 open decision 6; ⌘K is PAC-42), and three
 * dead controls read as broken rather than forthcoming.
 */
export function LeadDetailHeader({
  lead,
  onStatusChange,
  onTemperatureChange,
  pending,
}: LeadDetailHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-4 md:px-6">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Link to="/leads" className="hover:text-foreground transition-colors">
            Leads
          </Link>
          <ChevronRight size={12} aria-hidden />
          <span className="max-w-[16rem] truncate font-medium text-card-foreground">
            {lead.name}
          </span>
        </nav>

        <div className="hidden h-4 w-px bg-border sm:block" />

        <h1 className="truncate text-base font-semibold text-card-foreground">
          {lead.name}
        </h1>

        <LeadStatusSelect
          value={lead.status}
          onChange={onStatusChange}
          pending={pending}
        />
        <LeadTemperatureSelect
          value={lead.temperature}
          onChange={onTemperatureChange}
          pending={pending}
        />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <QuoteRecapAction
          leadId={lead.id}
          leadName={lead.name}
          className="px-3 py-1.5 font-semibold"
        />
        <SoldDealAction
          leadId={lead.id}
          leadName={lead.name}
          // Pre-selects the recap the sale came from when there is one; the
          // Sold form treats it as optional.
          quoteRecapId={lead.latestQuoteRecap?.id}
        />
      </div>
    </header>
  );
}
