import { AgencyPermission } from "@sfa/shared";
import {
  AtSign,
  Globe,
  KeyRound,
  Palette,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface SettingsSection {
  to: string;
  label: string;
  /** One line on the hub card. Says what the section is *for*, not what it is. */
  description: string;
  icon: LucideIcon;
  /** Read permission that both reveals the card and guards the route. */
  permission: string;
}

/**
 * The workspace-settings catalogue — one entry per agency-administration page.
 *
 * This is the single source of truth for **three** places that used to repeat
 * each other: the hub at `/settings`, the sidebar's single "Workspace Settings"
 * entry (which is visible when any of these permissions is held), and the route
 * guards in `App.tsx`. Before this, adding a settings page meant editing the
 * sidebar's Administration section and the route table and remembering that the
 * two permission strings had to agree — which is exactly how `/settings/roles`
 * once shipped gated on the *users* permission.
 *
 * The five sections used to be five sidebar rows. They are one row plus this
 * page now: they are configuration, visited rarely and usually in sequence when
 * setting an agency up, and five permanent rows of it crowded out the four
 * things people are in this app to do all day.
 *
 * `/settings/profile` is deliberately **not** here. It is personal, not the
 * workspace's, it needs no permission, and it is reached from the user chip in
 * the sidebar footer. The hub links to it in its own aside.
 */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    to: "/settings/users",
    label: "Agency Users",
    description:
      "Invite employees, set who they are, and remove people who have left.",
    icon: Users,
    permission: AgencyPermission.UsersRead,
  },
  {
    to: "/settings/roles",
    label: "Roles & Permissions",
    description: "What each role can see and do, page by page.",
    icon: KeyRound,
    permission: AgencyPermission.RolesRead,
  },
  {
    to: "/settings/branding",
    label: "Branding",
    description: "Your logo, agency name and the colours people sign in to.",
    icon: Palette,
    permission: AgencyPermission.BrandingRead,
  },
  {
    to: "/settings/domains",
    label: "Domains",
    description: "The hostname your team and your public forms live on.",
    icon: Globe,
    permission: AgencyPermission.DomainsRead,
  },
  {
    to: "/settings/email",
    label: "Email",
    description: "The address invites, resets and share links are sent from.",
    icon: AtSign,
    permission: AgencyPermission.EmailRead,
  },
];

/**
 * Every permission that grants access to at least one settings section.
 *
 * Feeds the `anyOf` gate on both the `/settings` route and the sidebar entry:
 * the hub itself holds nothing secret — it is a list of links each of which is
 * separately gated — so the right rule is "can you reach *any* of these", not
 * "are you the owner". A CSR holding none of them never sees the entry.
 */
export const SETTINGS_PERMISSIONS: string[] = SETTINGS_SECTIONS.map(
  (section) => section.permission,
);
