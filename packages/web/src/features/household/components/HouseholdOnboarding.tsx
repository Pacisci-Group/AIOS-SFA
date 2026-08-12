import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Lock, Star } from "lucide-react";
import { listOnboardingsForHousehold } from "@/lib/service-tickets-api";
import type { OnboardingChainStep, OnboardingView } from "@sfa/shared";

/**
 * The client's onboarding journey.
 *
 * Onboarding is tracked per client, so this is where it belongs — the three
 * calls each live in their own ticket, and a scheduled one is hidden from the
 * ticket queue until it opens. This block is the only place a CSR can see that
 * upcoming work before it lands on their plate.
 */
export function HouseholdOnboarding({ householdId }: { householdId?: string }) {
  const query = useQuery({
    queryKey: ["household-onboardings", householdId],
    queryFn: () => listOnboardingsForHousehold(householdId as string),
    enabled: Boolean(householdId),
  });

  const onboardings = query.data ?? [];
  if (!householdId || query.isLoading || onboardings.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Onboarding
      </h3>
      <div className="space-y-4">
        {onboardings.map((onboarding) => (
          <OnboardingBlock key={onboarding.id} onboarding={onboarding} />
        ))}
      </div>
    </div>
  );
}

function OnboardingBlock({ onboarding }: { onboarding: OnboardingView }) {
  const done = onboarding.chain.filter((s) => s.completedAt).length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Started {shortDate(onboarding.startedAt)}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] ${
            onboarding.isComplete
              ? "bg-[var(--kpi-green-bg,rgba(34,197,94,0.15))] text-[var(--kpi-green)]"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {onboarding.isComplete
            ? "Complete"
            : `${done} of ${onboarding.chain.length} calls`}
        </span>
      </div>

      <ol className="space-y-1">
        {onboarding.chain.map((link) => (
          <ChainRow key={link.stepKey} link={link} />
        ))}
      </ol>
    </div>
  );
}

function ChainRow({ link }: { link: OnboardingChainStep }) {
  const label = (
    <>
      <span className="shrink-0">
        {link.completedAt ? (
          <Check className="h-3.5 w-3.5 text-[var(--kpi-green)]" />
        ) : link.isOverdue ? (
          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
        ) : link.isActionable ? (
          <Star className="h-3.5 w-3.5 text-[var(--kpi-blue)]" />
        ) : (
          <Lock className="h-3 w-3 text-muted-foreground" />
        )}
      </span>
      <span
        className={
          link.completedAt ? "text-muted-foreground" : "text-foreground"
        }
      >
        {link.sequence}. {link.label}
      </span>
      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
        {link.completedAt
          ? shortDate(link.completedAt)
          : link.ticketId
            ? link.isActionable || link.isOverdue
              ? `due ${shortDate(link.dueAt)}`
              : `opens ${shortDate(link.availableAt)}`
            : "not scheduled"}
      </span>
    </>
  );

  // A scheduled call has a ticket that is hidden from the queue; linking to it
  // is the only way to reach it before it opens.
  return (
    <li className="text-xs">
      {link.ticketId ? (
        <Link
          to={`/crm/tickets?ticket=${link.ticketId}`}
          className="flex items-center gap-2 rounded px-1 py-1 transition-colors hover:bg-muted"
        >
          {label}
        </Link>
      ) : (
        <span className="flex items-center gap-2 px-1 py-1">{label}</span>
      )}
    </li>
  );
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
