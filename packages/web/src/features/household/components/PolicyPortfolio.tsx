import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ExternalLink,
  Heart,
  Plus,
  Shield,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { PolicySummary } from "@sfa/shared";
import { SectionLabel } from "@/components/common/DetailCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  statusColors,
  toDisplayPolicy,
  type DisplayPolicy as Policy,
} from "./policy-display";

interface CrossSell {
  line: string;
  opportunity: string;
  icon: LucideIcon;
  priority: "High" | "Medium";
  reason: string;
}

/**
 * Demo only. Nothing derives these: the reasons reference household facts we
 * never checked, and the original premium estimates ("~$45/mo") had no rating
 * source behind them at all, so they are gone. Deriving real opportunities
 * from the lines a household does *not* hold is tracked separately.
 */
const demoCrossSells: CrossSell[] = [
  {
    line: "Life Insurance",
    opportunity: "Term Life — 20yr",
    icon: Heart,
    priority: "High",
    reason: "Spouse + minor driver in household. No current life coverage on file.",
  },
  {
    line: "Motorcycle / Rec",
    opportunity: "Recreational Vehicle",
    icon: Shield,
    priority: "Medium",
    reason: "Teen driver flagged. Common add-on for households with 3+ vehicles.",
  },
];

/**
 * `SectionLabel`'s classes, as a string.
 *
 * The component renders a `<p>`, which is not valid inside the `<button>` that
 * is `PolicyCard`'s disclosure trigger. Same scale, same tier — see
 * `styles/TYPOGRAPHY.md`.
 */
const CARD_LABEL =
  "block text-xs font-medium uppercase tracking-wide text-muted-foreground";

const CROSS_SELL_PRIORITY: Record<CrossSell["priority"], string> = {
  High: "bg-red-500/12 text-red-600 dark:text-red-400",
  Medium: "bg-amber-500/15 text-amber-700 dark:text-amber-500",
};

/**
 * One policy in the portfolio grid, and on the policy detail page.
 *
 * Expanding is a disclosure, not navigation — "Open policy" in the expanded
 * body is what actually goes to `/policies/:id`. That button used to be a
 * hard-coded `#1d4ed8` `<button>` with no handler at all, so the one obvious
 * way into a policy did nothing.
 */
export function PolicyCard({
  policy,
  onClick,
  isSelected,
  /** Hidden on the policy detail page, which is already at that route. */
  showOpenLink = true,
}: {
  policy: Policy;
  onClick: () => void;
  isSelected: boolean;
  showOpenLink?: boolean;
}) {
  const Icon = policy.icon;
  // Pairs `aria-expanded` on the trigger with the region it discloses; without
  // it the state is announced but the target is not.
  const detailsId = `policy-${policy.id}-details`;
  return (
    <div
      className={cn(
        "rounded-xl border bg-card transition-colors",
        isSelected ? "border-primary bg-secondary" : "border-border",
      )}
    >
      {/*
        Everything inside the trigger is a `span`. A `<button>` may contain only
        phrasing content, so the `div`/`p` this had before was invalid markup;
        display comes from the classes either way, so it renders identically.
        `SectionLabel` is inlined as `CARD_LABEL` here for the same reason — the
        component renders a `<p>`.
      */}
      <button
        type="button"
        onClick={onClick}
        aria-expanded={isSelected}
        aria-controls={detailsId}
        className="w-full rounded-xl p-4 text-left"
      >
        <span className="mb-3 flex items-start justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg",
                policy.iconTint,
              )}
            >
              <Icon className={cn("size-5", policy.iconTone)} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-card-foreground">
                {policy.line}
              </span>
              <span className="block truncate text-xs tabular-nums text-muted-foreground">
                {policy.policyNumber}
              </span>
            </span>
          </span>
          <Badge
            size="sm"
            variant="ghost"
            className={cn("shrink-0", statusColors[policy.status])}
          >
            {policy.status}
          </Badge>
        </span>

        <span className="flex items-end justify-between gap-2">
          <span className="min-w-0">
            {/* Just "Premium" — the term rides on `premiumFreq` beside the
                figure, and "Annual Premium … $940 /6 mo" contradicts itself. */}
            <span className={CARD_LABEL}>Premium</span>
            <span className="mt-0.5 block text-lg font-semibold tabular-nums text-card-foreground">
              {policy.premium}
              <span className="text-xs font-normal text-muted-foreground">
                {policy.premiumFreq}
              </span>
            </span>
          </span>
          <span className="min-w-0 text-right">
            <span className={CARD_LABEL}>Expires</span>
            <span className="mt-0.5 block text-sm font-medium text-card-foreground">
              {policy.expiration}
            </span>
          </span>
        </span>
      </button>

      {isSelected && (
        <div
          id={detailsId}
          className="mx-4 flex flex-col gap-1.5 border-t border-border py-3"
        >
          <DetailLine label="Carrier" value={policy.carrier} />
          <DetailLine label="Effective" value={policy.effective} />
          {policy.deductible && (
            <DetailLine label="Deductible" value={policy.deductible} />
          )}
          {showOpenLink && (
            <Button asChild size="sm" className="mt-2 w-full">
              <Link to={`/policies/${policy.id}`}>
                <ExternalLink />
                Open policy
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-card-foreground">{value}</span>
    </div>
  );
}

function CrossSellCard({ item }: { item: CrossSell }) {
  const Icon = item.icon;
  return (
    <div className="group rounded-xl border border-dashed border-border p-4 transition-colors hover:border-primary/50">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted transition-colors group-hover:bg-primary/12"
        >
          <Icon className="size-4 text-muted-foreground transition-colors group-hover:text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-muted-foreground">
              {item.line}
            </p>
            <Badge
              size="sm"
              variant="ghost"
              className={CROSS_SELL_PRIORITY[item.priority]}
            >
              {item.priority} priority
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {item.opportunity}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{item.reason}</p>
          <Button variant="link" size="sm" className="mt-2 h-auto p-0">
            <TrendingUp />
            Start quote
          </Button>
        </div>
      </div>
    </div>
  );
}

interface PolicyPortfolioProps {
  policies: PolicySummary[];
  /** Enables the cross-sell block, which nothing derives yet. */
  isDemo?: boolean;
}

export function PolicyPortfolio({ policies, isDemo = false }: PolicyPortfolioProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Every policy renders — a lapsed one is exactly what a CSR needs to see, and
  // the card already carries a Lapsed badge. Only the headline count and the
  // premium total narrow to active, because both claim to describe active
  // coverage and a cancelled policy was inflating them.
  const displayPolicies = policies.map(toDisplayPolicy);
  const activePolicies = displayPolicies.filter((p) => p.status === "Active");

  // Summed across policy types, so it mixes a 6-month auto premium with an
  // annual property one. It is labelled "Total Premium" rather than "Total
  // Annual Premium" for that reason — no single term is true of the sum.
  const totalPremium = activePolicies.reduce((sum, p) => sum + p.premiumValue, 0);
  const inactiveCount = displayPolicies.length - activePolicies.length;

  return (
    // A plain scrolling block, deliberately not a flex column: as flex items
    // these sections would shrink to min-content to fit the height, squashing
    // the policy grid instead of overflowing into a scroll.
    <div className="h-full min-h-0 overflow-y-auto">
      {/* Summary bar */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-card-foreground">
            Policy portfolio
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {activePolicies.length} active{" "}
            {activePolicies.length === 1 ? "line" : "lines"}
            {inactiveCount > 0 && ` · ${inactiveCount} inactive`}
            {isDemo && ` · ${demoCrossSells.length} cross-sell opportunities`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <SectionLabel>Total premium</SectionLabel>
          <p className="text-xl font-semibold tabular-nums text-success">
            ${totalPremium.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-6 px-4 py-4 md:px-5">
        {/* Policies */}
        <section>
          <SectionLabel className="mb-3">Policies</SectionLabel>
          {displayPolicies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No policies on file.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {displayPolicies.map((p) => (
                <PolicyCard
                  key={p.id}
                  policy={p}
                  isSelected={selectedId === p.id}
                  onClick={() => setSelectedId(selectedId === p.id ? null : p.id)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Cross-sell section — demo only until real opportunities are derived. */}
        {isDemo && (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle
                aria-hidden
                className="size-4 text-amber-600 dark:text-amber-500"
              />
              <SectionLabel className="text-amber-600 dark:text-amber-500">
                Cross-sell opportunities
              </SectionLabel>
            </div>
            <div className="flex flex-col gap-3">
              {demoCrossSells.map((item) => (
                <CrossSellCard key={item.line} item={item} />
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full border-dashed text-muted-foreground"
            >
              <Plus />
              Add custom opportunity
            </Button>
          </section>
        )}
      </div>
    </div>
  );
}
