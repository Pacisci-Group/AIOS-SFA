import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Lock, Star } from "lucide-react";
import type { OnboardingChainStep, OnboardingView } from "@sfa/shared";
import { SectionLabel } from "@/components/common/DetailCard";
import { Badge } from "@/components/ui/badge";
import { listOnboardingsForHousehold } from "@/lib/service-tickets-api";
import { cn } from "@/lib/utils";

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
    <div className="border-b border-border px-4 py-4 md:px-5">
      <SectionLabel className="mb-3">Onboarding</SectionLabel>
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
        <span className="text-sm text-muted-foreground">
          Started {shortDate(onboarding.startedAt)}
        </span>
        <Badge
          size="sm"
          variant="ghost"
          className={
            onboarding.isComplete
              ? "bg-success/12 text-success"
              : "bg-muted text-muted-foreground"
          }
        >
          {onboarding.isComplete
            ? "Complete"
            : `${done} of ${onboarding.chain.length} calls`}
        </Badge>
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
          <Check aria-hidden className="size-4 text-success" />
        ) : link.isOverdue ? (
          <AlertTriangle
            aria-hidden
            className="size-4 text-red-600 dark:text-red-400"
          />
        ) : link.isActionable ? (
          <Star aria-hidden className="size-4 text-primary" />
        ) : (
          <Lock aria-hidden className="size-4 text-muted-foreground" />
        )}
      </span>
      <span
        className={cn(
          "truncate",
          link.completedAt ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {link.sequence}. {link.label}
      </span>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
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
    <li className="text-sm">
      {link.ticketId ? (
        <Link
          to={`/crm/tickets?ticket=${link.ticketId}`}
          className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-accent"
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
