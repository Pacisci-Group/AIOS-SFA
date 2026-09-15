import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import { SoldDealWizard } from "./components/SoldDealWizard";
import type { FlowError, SoldFlow } from "./modes/sold-flow";
import { useRewriteMode } from "./modes/useRewriteMode";
import { useSaleMode } from "./modes/useSaleMode";
import { useTransferMode } from "./modes/useTransferMode";

/**
 * The one page that writes policies, in whichever of its three modes the URL
 * asks for.
 *
 *   - `/sold/new?leadId={id}` — a **sale** (PAC-40).
 *   - `/sold/new?rewritePolicyId={id}` — a **cancel rewrite** (PAC-126).
 *   - `/policy-transfers/new?ticketId={id}` — a CSR's **package change**
 *     (PAC-63).
 *
 * All three ask for the same information, because a policy needs the same
 * information to exist however it came about: same wizard, same cards, same
 * validation, same documents. They differ in the record they anchor on, the
 * endpoint they post to and where they return to — and each of those lives in
 * its mode hook, not here.
 *
 * ## Why the transfer keeps a route of its own
 *
 * The routes carry different permission gates, and that is the only reason there
 * is more than one. `/sold/new` is gated on `deal_audits:write`, which is what
 * `POST /sold-deals` and `POST /policies/:id/rewrite` both require; the transfer
 * endpoint requires `crm_service:write` instead, and a CSR holds no
 * `deal_audits` permission at all. Serving the transfer from `/sold/new` would
 * lock out exactly the person it exists for. So: one page, three modes, two
 * routes — and a gate that matches its endpoint in both cases.
 *
 * Each mode ran as its own page component until PAC-126, and the three had
 * already drifted apart in their loading, retry and blocked-state handling
 * despite doing the same job. `SoldFlow` is what stopped that.
 */
export default function SoldDealPage() {
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();

  const leadId = searchParams.get("leadId") ?? "";
  const quoteRecapId = searchParams.get("quoteRecapId") ?? "";
  const rewritePolicyId = searchParams.get("rewritePolicyId") ?? "";
  const ticketId = searchParams.get("ticketId") ?? "";

  /*
   * Which flow this is, decided by which anchor the URL names. Checked
   * most-specific first so a stray leftover param cannot change the mode of a
   * flow that already has its own anchor.
   *
   * The path is consulted as well as the params, and only for the transfer:
   * `/policy-transfers/new` with no `ticketId` is still a transfer that is
   * missing its anchor, and it should redirect to the ticket queue rather than
   * being read as a sale with no lead and redirecting to /leads.
   */
  const mode =
    ticketId || pathname.startsWith("/policy-transfers")
      ? "transfer"
      : rewritePolicyId
        ? "rewrite"
        : "sale";

  /*
   * All three hooks run every render, and the two that are not this URL's mode
   * sit idle — their queries are disabled and their mutations never fire. That
   * is deliberate: the mode comes from search params, which change *without*
   * remounting this component, so calling one hook conditionally would break the
   * rules of hooks the first time someone navigated between two modes.
   */
  const sale = useSaleMode({
    leadId,
    quoteRecapId,
    enabled: mode === "sale",
  });
  const rewrite = useRewriteMode({
    policyId: rewritePolicyId,
    enabled: mode === "rewrite",
  });
  const transfer = useTransferMode({
    ticketId,
    enabled: mode === "transfer",
  });

  const flow: SoldFlow =
    mode === "transfer" ? transfer : mode === "rewrite" ? rewrite : sale;

  // A missing or malformed anchor id is only ever a typed or stale URL, so send
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
                householdId={flow.ready.householdId}
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
