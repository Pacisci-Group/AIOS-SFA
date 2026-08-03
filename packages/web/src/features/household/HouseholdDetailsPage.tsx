import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getHousehold } from "@/lib/households-api";
import { QuickActionBar } from "./components/QuickActionBar";
import { HouseholdProfile } from "./components/HouseholdProfile";
import { PolicyPortfolio } from "./components/PolicyPortfolio";
import { ActivityFeed } from "./components/ActivityFeed";
import { HouseholdOnboarding } from "./components/HouseholdOnboarding";

/**
 * Household detail. `/clients/:id` renders a live record; the legacy
 * `/clients/demo` route keeps rendering the original mock (the child
 * components fall back to their mock data when given no props).
 *
 * The page renders inside the app shell, so it has no top nav of its own.
 */
export default function HouseholdDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const isDemo = !id || id === "demo";

  const query = useQuery({
    queryKey: ["household", id],
    queryFn: () => getHousehold(id as string),
    enabled: !isDemo,
  });

  const household = isDemo ? undefined : query.data;

  return (
    <div
      className="flex flex-col"
      style={{
        height: "100%",
        background: "var(--background)",
        color: "var(--foreground)",
        overflow: "hidden",
      }}
    >
      {!isDemo && query.isPending && (
        <div className="px-6 py-4 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Loading household…
        </div>
      )}

      {!isDemo && query.isError && (
        <div className="px-6 py-4">
          <p className="text-sm text-red-400">Household not found.</p>
          <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
            It may have been removed, or it is outside your branch.
          </p>
        </div>
      )}

      {(isDemo || household) && (
        <>
          {/* Quick Action Bar */}
          <div className="shrink-0">
            <QuickActionBar
              householdName={household?.name ?? "The Cobb Household"}
            />
          </div>

          {/* 3-Column Layout */}
          <div className="flex flex-1 min-h-0">
            {/* Left Column — Household Profile (25%) */}
            <div
              className="flex flex-col border-r shrink-0"
              style={{
                width: "25%",
                minWidth: "260px",
                maxWidth: "320px",
                borderColor: "var(--border)",
                overflow: "hidden",
              }}
            >
              <HouseholdProfile household={household} />
            </div>

            {/* Middle Column — Policy Portfolio (50%) */}
            <div
              className="flex flex-col flex-1 border-r"
              style={{ borderColor: "var(--border)", overflow: "hidden" }}
            >
              <PolicyPortfolio policies={household?.policies} />
            </div>

            {/* Right Column — Activity Feed (25%) */}
            {/* Static: the client-record schemas carry no activity history. */}
            <div
              className="flex flex-col shrink-0"
              style={{
                width: "25%",
                minWidth: "260px",
                maxWidth: "340px",
                overflow: "hidden",
              }}
            >
              {/* Onboarding is tracked per client, so its progress belongs on
                  the client — and it is the only place a scheduled call is
                  visible before it opens in the ticket queue. */}
              <HouseholdOnboarding householdId={household?.id} />
              <ActivityFeed />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
