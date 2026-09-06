import { ModuleKey } from "@sfa/shared";

/**
 * What each module *is*, in the words an operator onboarding an agency would
 * use.
 *
 * The nav (`components/layout/nav-items.ts`) names the pages a module unlocks;
 * this names the capability being sold. They are different jobs, which is why
 * this is not derived from the nav — several modules gate no nav entry at all
 * (`quote_recaps`, `deal_audits`, `mailers`, `onboardings`), and one that
 * appeared blank on this screen would look like a bug rather than a choice.
 *
 * Exhaustive by construction: `Record<ModuleKey, …>` means adding a module key
 * to the enum is a compile error here until it is described.
 */
export interface ModuleDescriptor {
  label: string;
  description: string;
}

export const MODULE_CATALOG: Record<ModuleKey, ModuleDescriptor> = {
  [ModuleKey.Dashboard]: {
    label: "Producer Dashboard",
    description:
      "A producer's home screen — their scorecards, leaderboard standing and hot leads.",
  },
  [ModuleKey.Leads]: {
    label: "Leads",
    description:
      "The leads list, lead detail, and the New Lead form with its shareable public intake link.",
  },
  [ModuleKey.QuoteRecaps]: {
    label: "Quote Recaps",
    description: "Recording a quote against a household, with premiums and documents.",
  },
  [ModuleKey.Mailers]: {
    label: "Mailers",
    description:
      "Looking up a Quote Control Number from a mail campaign and logging the recipient as a lead.",
  },
  [ModuleKey.CrmService]: {
    label: "Service & Tickets",
    description:
      "The service dashboard, the ticket workspace, and renewal outreach.",
  },
  [ModuleKey.Clients]: {
    label: "Clients",
    description: "Household and policy detail — the 360° view of a client.",
  },
  [ModuleKey.DealAudits]: {
    label: "Deal Audits",
    description:
      "The Sold form and the post-sale compliance checklist it generates for the service hand-off.",
  },
  [ModuleKey.Onboardings]: {
    label: "Client Onboarding",
    description: "The scheduled call sequence a newly sold client is walked through.",
  },
  [ModuleKey.Management]: {
    label: "Management Dashboards",
    description: "Agency-wide overview and the lead-distribution command center.",
  },
  [ModuleKey.OwnerDashboard]: {
    label: "Owner Dashboard",
    description: "The owner's strategy view — KPIs and lead-source return.",
  },
  [ModuleKey.CommandCenter]: {
    label: "Command Center",
    description: "The unclaimed-lead pool and claim-by-call/text board.",
  },
  [ModuleKey.Performance]: {
    label: "Performance",
    description: "Sold and quoted scorecards, by producer and by period.",
  },
  [ModuleKey.Leaderboard]: {
    label: "Leaderboard",
    description:
      "The office leaderboard and goal tracking. Aggregates only — never another producer's rows.",
  },
};

/** The catalog in a stable display order, grouped the way the nav groups pages. */
export const MODULE_GROUPS: { title: string; modules: ModuleKey[] }[] = [
  {
    title: "Sales",
    modules: [
      ModuleKey.Dashboard,
      ModuleKey.Leads,
      ModuleKey.QuoteRecaps,
      ModuleKey.DealAudits,
      ModuleKey.Mailers,
    ],
  },
  {
    title: "Service & clients",
    modules: [ModuleKey.Clients, ModuleKey.CrmService, ModuleKey.Onboardings],
  },
  {
    title: "Management",
    modules: [
      ModuleKey.Management,
      ModuleKey.OwnerDashboard,
      ModuleKey.CommandCenter,
      ModuleKey.Performance,
      ModuleKey.Leaderboard,
    ],
  },
];
