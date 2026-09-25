import { ModuleKey } from "@sfa/shared";
import { Crown, Users } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OwnerDashboard } from "@/features/owner-dashboard/OwnerDashboard";
import { usePermissions } from "@/hooks/usePermissions";
import { useUrlState } from "@/hooks/useUrlState";
import { ManagerDashboard } from "./ManagerDashboard";

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
    blurb: "Is the data flowing? Stalled leads, aging audits, overdue tickets and the team's households.",
  },
};

/**
 * `/dashboard/management` — the Owner view (PAC-135) and the Manager view
 * (PAC-139), side by side behind one filter bar.
 *
 * Both are real now. The Owner view is `features/owner-dashboard`, behind
 * `owner_dashboard:read`; the Manager view is {@link ManagerDashboard}, behind
 * the route's `management:read`. The filter lives in the URL and is the same
 * filter for both, so switching tabs keeps the period and the selections.
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
            // Owner is the default, so it is written as "no param". The
            // drawers are Manager-only state; leaving them in the URL would
            // pop one open again the next time the tab is chosen.
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
        {view === "owner" ? <OwnerDashboard /> : <ManagerDashboard />}
      </div>
    </AppShell>
  );
}
