import { Link } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Ticket,
  Building2,
  BarChart3,
  LogOut,
  Shield,
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';

const navSections = [
  {
    title: 'Sales',
    items: [
      { to: '/dashboard/producer', label: 'Producer Dashboard', icon: LayoutDashboard },
      { to: '/leads/demo', label: 'Lead Details', icon: Users },
    ],
  },
  {
    title: 'Management',
    items: [
      { to: '/dashboard/management', label: 'Management Dashboard (v1)', icon: BarChart3 },
      { to: '/dashboard/management-alt', label: 'Management Dashboard (v2)', icon: BarChart3 },
    ],
  },
  {
    title: 'Service & CRM',
    items: [
      { to: '/crm/service', label: 'Service Dashboard', icon: Ticket },
      { to: '/crm/tickets', label: 'Ticket Workspace', icon: Ticket },
      { to: '/clients/demo', label: 'Household Details', icon: Building2 },
    ],
  },
];

export function DevNavPage() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-[#0B0F19] text-[#E2E8F0]">
      <header
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#38BDF8] flex items-center justify-center">
            <Shield size={16} className="text-[#0B0F19]" />
          </div>
          <div>
            <h1 className="text-sm font-bold">AgencyOps</h1>
            <p className="text-[10px] text-[#64748B] uppercase tracking-widest">
              Screen Navigator
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {user && (
            <span className="text-xs text-[#64748B]">{user.email}</span>
          )}
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1.5 text-xs text-[#64748B] hover:text-[#94A3B8]"
          >
            <LogOut size={14} />
            Log out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <p className="text-[#94A3B8] text-sm mb-8">
          All 7 Figma mockup screens are wired as routes. Pick a screen to preview — management
          v1 and v2 are both available for comparison.
        </p>

        <div className="space-y-8">
          {navSections.map((section) => (
            <section key={section.title}>
              <h2 className="text-[10px] uppercase tracking-widest text-[#64748B] mb-3">
                {section.title}
              </h2>
              <div className="grid gap-2">
                {section.items.map(({ to, label, icon: Icon }) => (
                  <Link
                    key={to}
                    to={to}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg transition-colors hover:bg-white/5"
                    style={{
                      background: '#161F30',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <Icon size={16} className="text-[#38BDF8] shrink-0" />
                    <span className="text-sm font-medium">{label}</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
