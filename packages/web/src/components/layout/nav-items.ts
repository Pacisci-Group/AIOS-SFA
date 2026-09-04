import {
  BarChart3,
  Home,
  LayoutDashboard,
  SlidersHorizontal,
  Ticket,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { ModuleKey } from "@sfa/shared";
import { SETTINGS_PERMISSIONS } from "@/features/settings/settings-sections";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Module read permission required to see the item. */
  module?: ModuleKey;
  /** Exact permission string required (for `agency:*` admin capabilities). */
  permission?: string;
  /**
   * Visible when the user holds **at least one** of these.
   *
   * For an entry that opens a hub rather than a page — Workspace Settings lists
   * five separately-gated sections, and anyone who can reach one of them should
   * be able to reach the list.
   */
  anyOf?: string[];
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
      /*
       * No "Mailer" entry. It pointed at `/mailers`, a route that has never
       * existed in `App.tsx` — PAC-22 (a standalone Mailer page) was cancelled
       * and PAC-61 put one explicitly out of scope. Harmless while
       * `mailers:read` was rare, but PAC-61 gave that permission to every role,
       * which would have promoted a hidden dead link into a universally visible
       * one leading to a blank screen. Mailers are reached from the drawer in
       * the Leads page header instead.
       */
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
      {
        to: "/clients",
        label: "Clients",
        icon: Home,
        module: ModuleKey.Clients,
      },
      /*
       * No "Ticket Workspace" entry here. The workspace is reached by opening a
       * ticket from the Service Dashboard, so a second top-level entry to the
       * same page only duplicated the queue.
       *
       * Clients above is gated on `ModuleKey.Clients`, not `crm_service`, which
       * is what keeps it hidden from a CSR — who holds `crm_service:*` and no
       * `clients:read`. A CSR still reaches an individual household through the
       * ticket's Household drawer; that path goes to `/clients/:id`, which
       * accepts either permission. `GET /households` does not, so pointing the
       * nav item at the list for them would only produce a 403.
       */
    ],
  },
  {
    /*
     * One entry, not the five this section used to hold.
     *
     * Agency Users · Roles & Permissions · Branding · Domains · Email were five
     * permanent rows of *configuration* sitting level with the four screens
     * people actually work in — and the list grows every time a settings page
     * is added. They live behind the hub at `/settings` now
     * (`features/settings/settings-sections.ts` is the catalogue), which is
     * also the one place their permissions are declared.
     */
    title: "Workspace",
    items: [
      {
        to: "/settings",
        label: "Workspace Settings",
        icon: SlidersHorizontal,
        anyOf: SETTINGS_PERMISSIONS,
      },
    ],
  },
];

/**
 * Whether `to` is the section of the app the user is currently in.
 *
 * Prefix-matching rather than `NavLink`'s `end` behaviour, so "Leads" stays lit
 * on `/leads/:id` and "Workspace Settings" on every `/settings/*` page — with an
 * exact match those pages highlighted nothing at all, which read as the nav
 * losing its place. The trailing slash is what keeps `/dashboard/management`
 * from claiming `/dashboard/management-alt`.
 */
export function isNavItemActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}
