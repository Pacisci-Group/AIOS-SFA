import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import { SoldDealWizard } from "./components/SoldDealWizard";
import type { FlowError } from "./modes/sold-flow";
import { useSaleMode } from "./modes/useSaleMode";

/**
 * `/sold/new?leadId={id}` — the one page that writes policies.
 *
 * A **sale** (PAC-40), and also the second step of a **replacement**: a Cancel
 * Rewrite or a Company Transfer runs on a lead created for it, so it is an
 * ordinary sale as far as this page is concerned. The lead carries the intent,
 * the wizard drops the cards that make no sense for a policy already ours, and
 * the server applies the retirement, the linking and the chargeback on submit
 * (PAC-126).
 *
 * Until PAC-126 there were three pages for this — a transfer anchored on a CRM
 * ticket, a rewrite anchored on the policy, and the sale — each with its own
 * endpoint, its own upload prefix and its own guards, and they had drifted apart
 * while doing the same job. `SoldFlow` is the shape they were reduced to, and
 * the mode hook is where the anchor, the endpoint and the return route live.
 */
export default function SoldDealPage() {
  const [searchParams] = useSearchParams();

  const flow = useSaleMode({
    leadId: searchParams.get("leadId") ?? "",
    quoteRecapId: searchParams.get("quoteRecapId") ?? "",
    enabled: true,
  });

  // A missing or malformed lead id is only ever a typed or stale URL, so send
  // them somewhere useful rather than explaining.
  if (flow.redirect) {
    return <Navigate to={flow.redirect} replace />;
  }

  return (
    <AppShell>
      <header className="flex items-center gap-2 border-b border-border px-4 py-4 md:gap-3 md:px-6">
        <MobileNav className="-ml-1" />
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground hover:text-foreground"
        >
          <Link to={flow.backTo} aria-label={flow.backLabel}>
            <ArrowLeft size={16} />
          </Link>
        </Button>
        <div>
          <h1 className="text-sm font-bold">{flow.title}</h1>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
            {flow.subtitle}
          </p>
        </div>
      </header>

      <main className="px-4 md:px-6 py-6">
        <div className="mx-auto w-full max-w-3xl space-y-4">
          {flow.loading && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              {flow.loading}
            </div>
          )}

          {flow.errors.map((error) => (
            <FlowErrorCard key={error.title} error={error} />
          ))}

          {flow.blocked && (
            <div className="space-y-2 rounded-xl border border-border bg-card p-6">
              <p className="flex items-center gap-2 text-base text-foreground">
                <AlertCircle className="size-4 shrink-0 text-destructive" />
                {flow.blocked.title}
              </p>
              <p className="text-sm text-muted-foreground">
                {flow.blocked.detail}
              </p>
              <Button asChild variant="outline" size="sm" className="mt-2">
                <Link to={flow.backTo}>{flow.backLabel}</Link>
              </Button>
            </div>
          )}

          {flow.ready && (
            <>
              {flow.ready.notice && (
                <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                  {flow.ready.notice}
                </p>
              )}
              <SoldDealWizard
                variant={flow.variant}
                context={flow.ready.context}
                carriers={flow.ready.carriers}
                staff={flow.ready.staff}
                uploadScope={flow.ready.uploadScope}
                submitting={flow.submitting}
                errorMessage={flow.errorMessage}
                onSubmit={flow.onSubmit}
              />
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}

/** A load that failed, with its retry where the mode offered one. */
function FlowErrorCard({ error }: { error: FlowError }) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-6">
      <p className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle size={16} />
        {error.title}
      </p>
      <p className="text-sm text-muted-foreground">{error.detail}</p>
      {error.retry && (
        <Button variant="outline" size="sm" onClick={error.retry}>
          Retry
        </Button>
      )}
    </div>
  );
}
