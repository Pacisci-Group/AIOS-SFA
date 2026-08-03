import { Link } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Ticket,
  Building2,
  BarChart3,
  LogOut,
  Shield,
  KeyRound,
  type LucideIcon,
} from 'lucide-react';
import { ModuleKey } from '@sfa/shared';
import { useAuth } from '@/contexts/auth-context';
import { usePermissions } from '@/hooks/usePermissions';

const navSections = [
  {
    title: 'Sales',
    items: [
      {
        to: '/dashboard/producer',
        label: 'Producer Dashboard',
        icon: LayoutDashboard,
        module: ModuleKey.Dashboard,
      },
      {
        to: '/leads',
        label: 'Lead Details',
        icon: Users,
        module: ModuleKey.Leads,
      },
    ],
  },
  {
    title: 'Management',
    items: [
      {
        to: '/dashboard/management',
        label: 'Management Dashboard (v1)',
        icon: BarChart3,
        module: ModuleKey.Management,
      },
      {
        to: '/dashboard/management-alt',
        label: 'Management Dashboard (v2)',
        icon: BarChart3,
        module: ModuleKey.Management,
      },
    ],
  },
  {
    title: 'Service & CRM',
    items: [
      {
        to: '/crm/service',
        label: 'Service Dashboard',
        icon: Ticket,
        module: ModuleKey.CrmService,
      },
      {
        to: '/crm/tickets',
        label: 'Ticket Workspace',
        icon: Ticket,
        module: ModuleKey.CrmService,
      },
      {
        to: '/clients/demo',
        label: 'Household Details',
        icon: Building2,
        module: ModuleKey.Clients,
      },
    ],
  },
];

function NavCard({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 px-4 py-3 rounded-lg bg-card border border-border transition-colors hover:bg-white/5"
    >
      <Icon size={16} className="text-primary shrink-0" />
      <span className="text-sm font-medium">{label}</span>
    </Link>
  );
}

export function DevNavPage() {
  const { user, logout } = useAuth();
  const { isOwner, canRead } = usePermissions();

  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canRead(item.module)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Shield size={16} className="text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-bold">AgencyOps</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
              Screen Navigator
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {user && (
            <span className="text-xs text-muted-foreground">{user.email}</span>
          )}
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-slate-400"
          >
            <LogOut size={14} />
            Log out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <p className="text-slate-400 text-sm mb-8">
          All 7 Figma mockup screens are wired as routes. Pick a screen to preview — management
          v1 and v2 are both available for comparison.
        </p>

        <div className="space-y-8">
          {visibleSections.map((section) => (
            <section key={section.title}>
              <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
                {section.title}
              </h2>
              <div className="grid gap-2">
                {section.items.map((item) => (
                  <NavCard key={item.to} {...item} />
                ))}
              </div>
            </section>
          ))}

          {isOwner && (
            <section>
              <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
                Administration
              </h2>
              <div className="grid gap-2">
                <NavCard to="/settings/users" label="Agency Users" icon={Users} />
                <NavCard
                  to="/settings/roles"
                  label="Roles & Permissions"
                  icon={KeyRound}
                />
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
