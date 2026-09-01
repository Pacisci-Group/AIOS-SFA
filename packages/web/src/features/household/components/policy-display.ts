import {
  Car,
  Home,
  Shield,
  Building2,
  Heart,
  Umbrella,
  type LucideIcon,
} from "lucide-react";
import type { PolicySummary } from "@sfa/shared";
import { normalizePolicyStatus } from "@sfa/shared";
import { premiumTermSuffix } from "@sfa/shared";

/**
 * The shape the policy cards render. Kept separate from the API's
 * `PolicySummary` because the cards were built against the original mock and
 * carry presentation concerns (icon, colors, preformatted premium).
 */
export interface DisplayPolicy {
  id: string;
  line: string;
  policyNumber: string;
  premium: string;
  premiumFreq: string;
  /** Numeric premium, for totals. */
  premiumValue: number;
  status: "Active" | "Pending" | "Lapsed";
  effective: string;
  expiration: string;
  icon: LucideIcon;
  /** Foreground class for {@link DisplayPolicy.icon}. */
  iconTone: string;
  /** Background class for the icon's tile. */
  iconTint: string;
  carrier: string;
  deductible?: string;
}

/**
 * Status pill classes for a policy.
 *
 * These were raw hex triples (`#052e16` / `#4ade80` / `#166534`) picked against
 * the navy theme — near-black tiles with mid-green text, invisible on the light
 * theme's `#F8FAFC`. They follow the `lead-display.ts` rules now: a token where
 * one carries the meaning, otherwise a `X-600 dark:X-400` pair over an alpha
 * tint that reads on either surface.
 */
export const statusColors: Record<DisplayPolicy["status"], string> = {
  Active: "bg-success/12 text-success",
  Pending: "bg-amber-500/15 text-amber-700 dark:text-amber-500",
  Lapsed: "bg-red-500/12 text-red-600 dark:text-red-400",
};

/** Icon and accent per line of business. */
const LINE_STYLES: Record<
  string,
  { icon: LucideIcon; iconTone: string; iconTint: string }
> = {
  auto: {
    icon: Car,
    iconTone: "text-sky-600 dark:text-sky-400",
    iconTint: "bg-sky-400/12",
  },
  home: {
    icon: Home,
    iconTone: "text-success",
    iconTint: "bg-success/12",
  },
  umbrella: {
    icon: Umbrella,
    iconTone: "text-violet-600 dark:text-violet-400",
    iconTint: "bg-violet-400/12",
  },
  life: {
    icon: Heart,
    iconTone: "text-pink-600 dark:text-pink-400",
    iconTint: "bg-pink-400/12",
  },
  landlord: {
    icon: Building2,
    iconTone: "text-amber-600 dark:text-amber-500",
    iconTint: "bg-amber-500/15",
  },
};

const DEFAULT_STYLE = {
  icon: Shield,
  iconTone: "text-slate-600 dark:text-slate-400",
  iconTint: "bg-slate-400/12",
};

/**
 * Normalize the free-text `policyStatus` from the migrated records into the
 * three buckets the cards can render. Unknown values fall back to the policy's
 * `active` flag.
 *
 * Runs `normalizePolicyStatus` first (PAC-80): the substring tests below were
 * written against labels, and a migrated policy stored the raw code `QsrnM`, so
 * every one of them fell straight through to the `active` flag. `Quoted` still
 * falls through, deliberately — the cards have no bucket for it and the flag is
 * the better answer than inventing one.
 */
function toCardStatus(policy: PolicySummary): DisplayPolicy["status"] {
  const raw = normalizePolicyStatus(policy.policyStatus).toLowerCase();
  if (raw.includes("pending")) return "Pending";
  if (raw.includes("laps") || raw.includes("cancel")) return "Lapsed";
  if (raw.includes("active")) return "Active";
  return policy.active ? "Active" : "Lapsed";
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function toDisplayPolicy(policy: PolicySummary): DisplayPolicy {
  const style = LINE_STYLES[(policy.policyType ?? "").toLowerCase()] ?? DEFAULT_STYLE;
  return {
    id: policy.id,
    line: policy.policyType ?? "Policy",
    policyNumber: policy.policyNumber ?? "—",
    premium: `$${policy.premium.toLocaleString()}`,
    // Auto is quoted on a 6-month term (2026-08-19 scrum), so the unit follows
    // the policy type rather than being hard-coded annual.
    premiumFreq: premiumTermSuffix(policy.policyType),
    premiumValue: policy.premium,
    status: toCardStatus(policy),
    effective: formatDate(policy.effectiveDate),
    expiration: formatDate(policy.expirationDate),
    carrier: policy.carrier ?? "—",
    deductible: undefined,
    ...style,
  };
}
