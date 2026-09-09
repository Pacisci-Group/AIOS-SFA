import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronRight, Loader2, StickyNote, Users } from "lucide-react";
import {
  isCanonicalPolicyType,
  itemCountLabel,
  policyTypeHasItemCount,
  premiumTermSuffix,
} from "@sfa/shared";
import { DataRow, DetailCard } from "@/components/common/DetailCard";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPolicy } from "@/lib/policies-api";
import { PolicyCard } from "@/features/household/components/PolicyPortfolio";
import {
  statusColors,
  toDisplayPolicy,
} from "@/features/household/components/policy-display";
import { cn } from "@/lib/utils";

/** `Jun 9, 2026`, or an em dash. */
function shortDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Read-only policy detail at `/policies/:id`.
 *
 * Renders inside `AppShell` like every other page — it used to render bare, so
 * following a policy link out of a ticket dropped the reader onto a screen with
 * no sidebar and a hand-rolled `navigate(-1)` "Back" as the only way out. The
 * breadcrumb now names where they are, and the household card names where the
 * policy belongs.
 *
 * The summary card reuses the household page's `PolicyCard`, so a policy looks
 * the same wherever it is shown; the terms below it are the fields that card
 * has no room for.
 */
export default function PolicyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [expanded, setExpanded] = useState(true);

  const query = useQuery({
    queryKey: ["policy", id],
    queryFn: () => getPolicy(id as string),
    enabled: !!id,
  });

  const policy = query.data;
  const display = policy ? toDisplayPolicy(policy) : null;

  return (
    <AppShell>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-4 md:gap-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <MobileNav className="-ml-1" />
          <nav
            aria-label="Breadcrumb"
            className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex"
          >
            {policy?.household ? (
              <Link
                to={`/clients/${policy.household.id}`}
                className="transition-colors hover:text-foreground"
              >
                {policy.household.name ?? "Household"}
              </Link>
            ) : (
              <span>Policies</span>
            )}
            <ChevronRight aria-hidden className="size-4" />
          </nav>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight text-card-foreground">
              {policy ? `${policy.policyType} policy` : "Policy"}
            </h1>
            <p className="text-xs font-medium uppercase tracking-wide tabular-nums text-muted-foreground">
              {policy?.policyNumber ?? " "}
            </p>
          </div>
        </div>

        {display && (
          <Badge
            size="lg"
            variant="ghost"
            className={cn("shrink-0", statusColors[display.status])}
          >
            {display.status}
          </Badge>
        )}
      </header>

      {query.isPending && (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-5 animate-spin" />
          Loading policy…
        </div>
      )}

      {query.isError && (
        <div className="m-4 space-y-3 rounded-xl border border-border bg-card p-6 md:m-6">
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle aria-hidden className="size-5" />
            Policy not found.
          </p>
          <p className="text-sm text-muted-foreground">
            It may have been removed, or it is outside your branch.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
      )}

      {policy && display && (
        <main className="flex max-w-3xl flex-col gap-4 p-4 md:p-6">
          <PolicyCard
            policy={display}
            isSelected={expanded}
            onClick={() => setExpanded((v) => !v)}
            // Already on that page — an "Open policy" link to itself is a
            // no-op the reader has to try before they learn it.
            showOpenLink={false}
          />

          <DetailCard title="Policy terms">
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <DataRow label="Carrier" value={policy.carrier ?? "—"} />
              <DataRow
                label="Premium"
                value={
                  <span className="tabular-nums">
                    ${policy.premium.toLocaleString()}
                    <span className="text-muted-foreground">
                      {premiumTermSuffix(policy.policyType)}
                    </span>
                  </span>
                }
              />
              {/*
                Shown only where the count means something: the vehicle types,
                which are the only ones asked for it — plus any uncatalogued
                migrated type, whose stored count we cannot assume is the
                implied 1. Same rule as `PolicyDrawer`.
              */}
              {(policyTypeHasItemCount(policy.policyType) ||
                !isCanonicalPolicyType(policy.policyType)) && (
                <DataRow
                  label={itemCountLabel(policy.policyType)}
                  value={
                    <span className="tabular-nums">{policy.items}</span>
                  }
                />
              )}
              <DataRow
                label="Effective"
                value={shortDate(policy.effectiveDate)}
              />
              <DataRow label="Renews" value={shortDate(policy.renewalDate)} />
              <DataRow label="Expires" value={shortDate(policy.expirationDate)} />
            </div>
          </DetailCard>

          {policy.household && (
            <DetailCard
              title="Household"
              icon={Users}
              action={
                <Button asChild variant="outline" size="sm">
                  <Link to={`/clients/${policy.household.id}`}>
                    View household
                  </Link>
                </Button>
              }
            >
              <p className="text-base text-card-foreground">
                {policy.household.name ?? "Household"}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {policy.household.totalActivePolicies} active{" "}
                {policy.household.totalActivePolicies === 1
                  ? "policy"
                  : "policies"}
              </p>
            </DetailCard>
          )}

          {policy.notes && (
            <DetailCard title="Notes" icon={StickyNote}>
              <p className="whitespace-pre-line text-base text-card-foreground">
                {policy.notes}
              </p>
            </DetailCard>
          )}
        </main>
      )}
    </AppShell>
  );
}
