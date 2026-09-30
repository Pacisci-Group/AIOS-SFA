import { Clock, Star } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import type { HotLeadRow as HotLead } from "@/lib/leads-api";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import { LeadQuickActions } from "./LeadQuickActions";

interface HotLeadRowProps {
  lead: HotLead;
  isLast: boolean;
}

export function HotLeadRow({ lead, isLast }: HotLeadRowProps) {
  const isHot = lead.temperature === "Hot";

  return (
    <div
      className={cn(
        "group px-4 py-4 transition-all hover:bg-muted/50 md:px-5",
        !isLast && "border-b border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5 font-bold border",
            isHot
              ? "bg-red-400/12 text-red-300 border-red-400/25"
              : "bg-muted text-muted-foreground border-border",
          )}
        >
          {lead.initials}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to={`/leads/${lead.id}`}
              className="text-sm text-foreground truncate font-semibold hover:text-primary hover:underline"
            >
              {lead.name}
            </Link>
            {/* The normalized source label. The mockup paired each source with
                an emoji, but no emoji vocabulary exists anywhere in the app and
                its labels ("Mailers", "Internet Lead", "Walk-in") match none of
                the 14 canonical sources. */}
            <Badge
              size="sm"
              className="shrink-0 bg-muted font-normal text-muted-foreground"
            >
              {lead.leadSource || "No source"}
            </Badge>
            {isHot && (
              <Star
                className="size-3 shrink-0 text-amber-500"
                fill="currentColor"
              />
            )}
          </div>

          {/* The narrative line: the lead's most recent activity, which is a
              mix of system events and producer-written notes. Falls back to the
              pipeline status rather than inventing copy. */}
          <p className="text-xs mt-1 leading-relaxed text-muted-foreground">
            {lead.lastActivitySummary ?? lead.status}
          </p>
        </div>

        <div className="mt-0.5 flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3" />
          {/* "never", not N/A: a lead with no activity has not been touched,
              which is a fact about it rather than a missing value. */}
          {relativeTime(lead.lastActivityAt, "never")}
        </div>
      </div>

      <div className="mt-3 ml-12">
        <LeadQuickActions
          leadId={lead.id}
          phone={lead.phone}
          email={lead.email}
          deceasedAt={lead.primaryContactDeceasedAt}
        />
      </div>
    </div>
  );
}
