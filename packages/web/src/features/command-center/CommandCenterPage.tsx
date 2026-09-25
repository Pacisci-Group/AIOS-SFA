import { AppShell } from "@/components/layout/AppShell";
import { CommandCenterHeader } from "./components/CommandCenterHeader";
import { UnclaimedPoolPanel } from "./components/UnclaimedPoolPanel";

/**
 * The Agency Command Center (PAC-138) — `/dashboard/management-alt`.
 *
 * A lead-distribution board: what nobody has picked up yet, and who to hand it
 * to.
 *
 * ## Replaces a 657-line mockup, rather than refactoring it
 *
 * The page this supersedes had seven hard-coded leads with arrival times
 * computed at module load (so the "aging" froze on the bundle's first import),
 * six invented pipeline rows, three fake quote control numbers, a header naming
 * a different person from the sidebar below it, and dark-only Tailwind
 * (`bg-[#0d1421]`, `bg-blue-900/60`) that rendered wrong on the light theme.
 * Prototype dashboards are throwaway by design — the mockup was a picture of
 * intent, not code with a bug in it.
 *
 * ## One job, deliberately
 *
 * The prototype also carried a "My Working & Hot Leads Pipeline" below the
 * pool. It is **not** here: the viewer's own leads already have a home on the
 * Producer Dashboard (`/dashboard/producer`, PAC-15), and a second copy on this
 * screen would be two places to read the same list and two places to fix when
 * it changes. This page answers one question — what is unassigned, and who
 * should get it.
 *
 * ## Scope
 *
 * `UnclaimedPoolPanel` reads **agency-wide** — it is the one lead surface that
 * crosses `DataScope`, because a pool nobody can see distributes nothing, and
 * the API withholds contact details to pay for it. See
 * `UnclaimedLeadsService`.
 *
 * ## Permissions
 *
 * The route is gated on `management:read` in `App.tsx`. Access is
 * all-or-nothing per page. The one finer check is *acting* on a pool row, which
 * needs `leads:write` + `agency:users:read` and lives in `UnclaimedPoolPanel`.
 */
export default function CommandCenterPage() {
  return (
    <AppShell>
      <CommandCenterHeader />

      <div className="flex flex-1 flex-col px-4 pb-6 md:px-6">
        <UnclaimedPoolPanel />
      </div>
    </AppShell>
  );
}
