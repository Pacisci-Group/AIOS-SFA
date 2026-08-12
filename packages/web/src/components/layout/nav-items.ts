import {
  BarChart3,
  KeyRound,
  LayoutDashboard,
  Mail,
  Ticket,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { ModuleKey } from "@sfa/shared";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Module read permission required to see the item. */
  module?: ModuleKey;
  /** Exact permission string required (for `agency:*` admin capabilities). */
  permission?: string;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Sales",
    items: [
      {
        to: "/dashboard/producer",
        label: "Producer Dashboard",
        icon: LayoutDashboard,
        module: ModuleKey.Dashboard,
      },
      {
        to: "/leads",
        label: "Leads",
        icon: Users,
        module: ModuleKey.Leads,
      },
      {
        to: "/mailers",
        label: "Mailer",
        icon: Mail,
        module: ModuleKey.Mailers,
      },
      {
        to: "/performance",
        label: "My Performance",
        icon: TrendingUp,
        module: ModuleKey.Performance,
      },
    ],
  },
  {
    // "Management Dashboard" / "Management (Alt)" repeated the section heading
    // and overflowed the rail at any width worth having. The section says
    // Management; the items only have to say which one — and "Command Center"
    // is what v2 actually is (AGENTS.md §4).
    title: "Management",
    items: [
      {
        to: "/dashboard/management",
        label: "Overview",
        icon: BarChart3,
        module: ModuleKey.Management,
      },
      {
        to: "/dashboard/management-alt",
        label: "Command Center",
        icon: BarChart3,
        module: ModuleKey.Management,
      },
    ],
  },
  {
    title: "Service & CRM",
    items: [
      {
        to: "/crm/service",
        label: "Service Dashboard",
        icon: Ticket,
        module: ModuleKey.CrmService,
      },
      /*
       * No "Ticket Workspace" or "Households" entry here.
       *
       * The workspace is reached by opening a ticket from the Service
       * Dashboard, so a second top-level entry to the same page only
       * duplicated the queue. `/clients/demo` is still the unwired Household
       * Details mockup and is deliberately kept out of the sidebar — it is
       * reachable from the dev Screen Navigator at `/`. Add it back (gated on
       * `ModuleKey.Clients`) once the real list view lands (PAC-57).
       */
    ],
  },
  {
    title: "Administration",
    items: [
      {
        to: "/settings/users",
        label: "Agency Users",
        icon: Users,
        permission: "agency:users:read",
      },
      {
        to: "/settings/roles",
        label: "Roles & Permissions",
        icon: KeyRound,
        permission: "agency:users:permissions",
      },
    ],
  },
];

/**
 * Whether `to` is the section of the app the user is currently in.
 *
 * Prefix-matching rather than `NavLink`'s `end` behaviour, so "Leads" stays lit
 * on `/leads/:id` and "Agency Users" on `/settings/users/:id/permissions` —
 * with an exact match those pages highlighted nothing at all, which read as the
 * nav losing its place. The trailing slash is what keeps `/dashboard/management`
 * from claiming `/dashboard/management-alt`.
 */
export function isNavItemActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}
