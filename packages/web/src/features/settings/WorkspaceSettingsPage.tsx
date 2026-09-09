import { ChevronRight, SlidersHorizontal, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePermissions } from '@/hooks/usePermissions';
import { useTenant } from '@/contexts/tenant-context';
import { SettingsPage } from './SettingsPage';
import { SETTINGS_SECTIONS } from './settings-sections';

/**
 * The workspace-settings hub at `/settings` — one page listing every agency
 * administration area the signed-in user can reach.
 *
 * ## Why this exists
 *
 * The five settings pages were five permanent rows in the sidebar's
 * "Administration" section. That put configuration — visited rarely, and
 * usually in one sitting while an agency is being set up — on equal footing
 * with the four screens people work in all day, and it grows by a row every
 * time a settings page is added (branches are next). One entry that opens a
 * hub keeps the rail about the work.
 *
 * ## Who reaches it
 *
 * Not "the owner": every card is separately permission-gated and the route is
 * an `anyOf` gate over the same list, so a Branch Manager who holds only
 * `agency:users:read` gets here and sees exactly one card. Nothing about this
 * page is owner-only — it holds no secrets of its own, it is a list of links.
 */
export default function WorkspaceSettingsPage() {
  const { can } = usePermissions();
  const { branding } = useTenant();

  const sections = SETTINGS_SECTIONS.filter((section) =>
    can(section.permission),
  );

  return (
    <SettingsPage
      title="Workspace Settings"
      caption={branding.name}
      icon={SlidersHorizontal}
      backTo="/"
      width="wide"
    >
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
        Everything that applies to the whole agency. Changes here affect all of
        your people.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Link
              key={section.to}
              to={section.to}
              className="group flex items-start gap-3 rounded-xl border border-border bg-card px-5 py-4 transition-colors outline-none hover:border-primary/40 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-card-foreground">
                  {section.label}
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  {section.description}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
            </Link>
          );
        })}
      </div>

      {/*
        Personal, not the workspace's — so it sits below the grid rather than in
        it, and carries no permission check because everybody owns their own
        profile. It is listed here because "settings" is where people look for
        it, even though the sidebar's user chip is the shorter route.
      */}
      <div className="mt-8 border-t border-border pt-6">
        <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Personal
        </p>
        <Link
          to="/settings/profile"
          className="group flex max-w-md items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 transition-colors outline-none hover:border-primary/40 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <UserRound className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-card-foreground">
              My profile
            </span>
            <span className="mt-0.5 block text-sm text-muted-foreground">
              Your name, avatar and password.
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
        </Link>
      </div>
    </SettingsPage>
  );
}
