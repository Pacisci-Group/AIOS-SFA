import {
  Bug,
  Building2,
  Mail,
  Megaphone,
  Rocket,
  UserSearch,
  type LucideIcon,
} from "lucide-react";

export interface PanelArea {
  key: string;
  label: string;
  description: string;
  /** `undefined` = not built yet. Rendered disabled, never hidden. */
  to?: string;
  icon: LucideIcon;
}

/**
 * The Super Admin panel's areas (PAC-73).
 *
 * **Onboard Agency** (PAC-69), **Find / Impersonate User** (PAC-70), **Bug
 * Reports** (PAC-82) and **Add Mailers** are live. The rest are shown disabled
 * with "Coming soon" so the shape of the product reads at a glance — hiding
 * them would hide the roadmap from the people the panel is for. Nothing
 * navigates anywhere it cannot go, and there are no fake screens behind any of
 * them.
 *
 * ⚠ **Add Mailers is last and is temporary.** PAC-71 folds it into Mailer
 * Campaigns and deletes it; when that lands, remove this entry and the route,
 * not just the link. Bug Reports sits immediately above it and is permanent —
 * keep the temporary entry at the bottom as new areas land.
 */
export const PANEL_AREAS: PanelArea[] = [
  {
    key: "agencies",
    label: "Agencies",
    description: "Directory, branches and team members.",
    icon: Building2,
  },
  {
    key: "users",
    label: "Find / Impersonate User",
    description: "Search across every tenant and step into a session.",
    to: "/admin/users",
    icon: UserSearch,
  },
  {
    key: "onboard",
    label: "Onboard Agency",
    description: "Guided setup: agency, first branch, modules, owner invite.",
    to: "/admin/agencies/onboard",
    icon: Rocket,
  },
  {
    key: "campaigns",
    label: "Mailer Campaigns",
    description: "Past campaigns, quote files, and running a new one.",
    icon: Megaphone,
  },
  {
    key: "bugs",
    label: "Bug Reports",
    description: "Everything filed from the in-app Report a bug button.",
    to: "/admin/bugs",
    icon: Bug,
  },
  {
    key: "add-mailers",
    label: "Add Mailers",
    description: "Upload an agency's RTP file and import the mailers.",
    to: "/admin/mailers/add",
    icon: Mail,
  },
];
