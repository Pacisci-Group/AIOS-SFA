import { ModuleKey } from "@sfa/shared";
import { Crown, Users } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OwnerDashboard } from "@/features/owner-dashboard/OwnerDashboard";
import { usePermissions } from "@/hooks/usePermissions";
import { useUrlState } from "@/hooks/useUrlState";
import { GlobalFilterBar } from "./components/GlobalFilterBar";
import { ManagerDashboard } from "./components/ManagerDashboard";

type View = "owner" | "manager";

const VIEW_DEFAULTS = { view: "" } as const;
const VIEW_ALLOWED = { view: ["owner", "manager"] } as const;

const COPY: Record<View, { title: string; blurb: string }> = {
  owner: {
    title: "Strategy Hub",
    blurb: "Everything going on in the agency: premium, mix, producers and lead sources.",
  },
  manager: {
    title: "Action Hub",
    blurb: "Team operations, pipeline friction points and producer coaching.",
  },
};

/**
 * `/dashboard/management` — the Owner view (PAC-135) and, beside it, the Manager
 * view.
 *
 * The **Owner view is real**: `features/owner-dashboard`, behind
 * `owner_dashboard:read`. The **Manager view is still the Figma prototype** —
 * hard-coded data, inline styles, undefined colour variables — kept reachable
 * because the office-manager work (PAC-106) replaces it, not this ticket. It is
 * quarantined in {@link ManagerPrototype} so none of it leaks into the page.
 *
 * What went with the mockup's chrome: the "Greenfield Insurance" brand block
 * (the sidebar already carries the agency's own brand), the second Owner/Manager
 * toggle (there were two, controlling the same thing), the "All Offices" button
 * (it opened nothing; branches are PAC-90), the notification bell and avatar
 * (fixtures), and the "Live · Last synced" footer (nothing was syncing).
 *
 * The view lives in the URL, like every other piece of state on this page. It
 * is only a *choice* for someone who may see both; an account without
 * `owner_dashboard:read` gets the Manager view and no tabs.
 */
export default function ManagementDashboardPage() {
  const { canRead } = usePermissions();
  const canSeeOwner = canRead(ModuleKey.OwnerDashboard);

  const [{ view: requested }, setUrl] = useUrlState({
    defaults: VIEW_DEFAULTS,
    allowed: VIEW_ALLOWED,
  });
  // The URL is a request, not an authorization: `?view=owner` from an account
  // that cannot read the Owner dashboard still lands on the Manager view.
  const view: View =
    canSeeOwner && requested !== "manager" ? "owner" : "manager";

  const Icon = view === "owner" ? Crown : Users;

  return (
    <AppShell>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <MobileNav className="-ml-1" />
          <Icon aria-hidden className="size-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">
              {COPY[view].title}
            </h1>
            <p className="truncate text-sm text-muted-foreground">
              {COPY[view].blurb}
            </p>
          </div>
        </div>

        {canSeeOwner && (
          <Tabs
            value={view}
            // Owner is the default, so it is written as "no param".
            onValueChange={(next) =>
              setUrl({ view: next === "manager" ? "manager" : "" })
            }
          >
            <TabsList>
              <TabsTrigger value="owner">Owner</TabsTrigger>
              <TabsTrigger value="manager">Manager</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </header>

      <div className="flex-1">
        {view === "owner" ? <OwnerDashboard /> : <ManagerPrototype />}
      </div>
    </AppShell>
  );
}

const PROTOTYPE_FILTERS = {
  producer: "All Producers",
  leadSource: "All Sources",
  lineOfBusiness: "All Lines",
  dateRange: "This Month",
};

/**
 * The Manager view, exactly as the Figma export left it. Not wired to anything:
 * its filters are display strings held in local state, and its numbers are
 * fixtures. Do not copy from it — see `packages/web/CLAUDE.md`.
 */
function ManagerPrototype() {
  const [filters, setFilters] = useState(PROTOTYPE_FILTERS);

  return (
    <>
      <GlobalFilterBar filters={filters} onChange={setFilters} />
      <div className="px-4 py-5 md:px-6">
        <ManagerDashboard />
      </div>
    </>
  );
}
