import { ChevronRight, Mail, Phone } from "lucide-react";
import { Link } from "react-router-dom";
import { QuoteRecapAction } from "@/components/leads/QuoteRecapAction";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatPhone, type LeadRow } from "@/lib/leads-api";
import {
  statusBadgeClass,
  temperatureDot,
  temperatureText,
} from "./lead-display";

/**
 * Mobile Leads row. Below `md` the table's 7 columns don't fit, so each lead
 * becomes a stacked card — the same information, laid out vertically.
 */
export function LeadCard({ lead }: { lead: LeadRow }) {
  return (
    // Stretched-link rather than a card-wide `<Link>`: the quote-recap action
    // is itself a link, and nesting one anchor inside another is invalid HTML.
    <div className="relative flex items-center gap-3 px-4 py-3.5 rounded-xl bg-card border border-border transition-colors hover:bg-muted/50 active:scale-[0.99]">
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            to={`/leads/${lead.id}`}
            className="text-base text-foreground font-medium truncate after:absolute after:inset-0 after:content-['']"
          >
            {lead.name}
          </Link>
          <Badge
            size="sm"
            className={cn("shrink-0 font-semibold", statusBadgeClass(lead.status))}
          >
            {lead.status}
          </Badge>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <span
            className="flex items-center gap-1.5"
            title={`Temperature: ${lead.temperature}`}
          >
            <span
              className={cn(
                "size-2 rounded-full shrink-0",
                temperatureDot[lead.temperature],
              )}
            />
            <span className={temperatureText[lead.temperature]}>
              {lead.temperature}
            </span>
          </span>
          <span className="text-muted-foreground truncate">
            {lead.leadSource}
          </span>
        </div>

        {lead.phone && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Phone className="size-4 shrink-0" />
            {formatPhone(lead.phone)}
          </p>
        )}
        {lead.email && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground truncate">
            <Mail className="size-4 shrink-0" />
            <span className="truncate">{lead.email}</span>
          </p>
        )}
      </div>

      <QuoteRecapAction leadId={lead.id} leadName={lead.name} iconOnly />
      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
    </div>
  );
}
