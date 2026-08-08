import type { LeadTemperature } from "@sfa/shared";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { Navigate, useParams } from "react-router-dom";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Button } from "@/components/ui/button";
import { getLead } from "@/lib/leads-api";
import { ActivityTimeline } from "./components/ActivityTimeline";
import { HouseholdCard } from "./components/HouseholdCard";
import { LeadContactCard } from "./components/LeadContactCard";
import { LeadDetailHeader } from "./components/LeadDetailHeader";
import { PriorInsuranceCard } from "./components/PriorInsuranceCard";
import { QuoteRecapCard } from "./components/QuoteRecapCard";
import { SoldCard } from "./components/SoldCard";
import { leadDetailKey, useUpdateLead } from "./components/useUpdateLead";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * `/leads/:id` — the Lead Detail 360° view (PAC-38).
 *
 * The whole page comes from one `GET /leads/:id`; the API assembles the lead,
 * household, quote, deal, prior insurance and timeline server-side so this does
 * not fan out into six requests.
 *
 * Layout follows the mockup's asymmetric 60/40 split above `lg` and stacks to a
 * single column below it. Cards with no data are **omitted**, not rendered
 * empty: an unsold lead shows no Prior Insurance card at all, and a lead that
 * has never been quoted shows no Quote Summary.
 */
export default function LeadDetailsPage() {
  const { id = "" } = useParams<{ id: string }>();

  const leadQuery = useQuery({
    queryKey: leadDetailKey(id),
    queryFn: () => getLead(id),
    enabled: OBJECT_ID.test(id),
  });

  const update = useUpdateLead(id);

  // Nothing to load — `/leads/demo` and any hand-typed id land here.
  if (!OBJECT_ID.test(id)) {
    return <Navigate to="/leads" replace />;
  }

  const lead = leadQuery.data;

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* The app shell isn't responsive yet; hidden rather than cramped. */}
      <div className="hidden md:block">
        <AppSidebar />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {lead && (
          <LeadDetailHeader
            lead={lead}
            onStatusChange={(status) => update.mutate({ status })}
            onTemperatureChange={(temperature: LeadTemperature) =>
              update.mutate({ temperature })
            }
            pending={update.isPending}
          />
        )}

        {leadQuery.isPending && (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            Loading lead…
          </div>
        )}

        {leadQuery.isError && (
          <div className="m-4 space-y-3 rounded-xl border border-border bg-card p-6 md:m-6">
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle size={16} />
              {leadQuery.error.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void leadQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        )}

        {lead && (
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <main className="flex flex-col gap-4 p-4 md:p-5 lg:w-3/5">
              <LeadContactCard
                lead={lead}
                onSourceChange={(leadSourceCode) =>
                  update.mutate({ leadSourceCode })
                }
                pending={update.isPending}
              />

              {/* Only reachable once the lead is sold — see the card's docblock. */}
              {lead.priorInsurance && (
                <PriorInsuranceCard priorInsurance={lead.priorInsurance} />
              )}

              {lead.latestQuoteRecap && (
                <QuoteRecapCard
                  latest={lead.latestQuoteRecap}
                  earlier={lead.earlierQuoteRecaps}
                />
              )}

              {/* Below the quote summary on purpose (PAC-56 #27) — the page
                  reads quoted → sold. */}
              {lead.deal && <SoldCard deal={lead.deal} leadId={lead.id} />}
            </main>

            <aside className="flex flex-col gap-4 p-4 md:p-5 lg:w-2/5 lg:border-l lg:border-border">
              <HouseholdCard household={lead.household} />
              <div className="min-h-[24rem] flex-1">
                <ActivityTimeline
                  activities={lead.activities}
                  leadId={lead.id}
                />
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
