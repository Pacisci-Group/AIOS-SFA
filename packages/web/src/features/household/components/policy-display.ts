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
  iconColor: string;
  iconBg: string;
  carrier: string;
  deductible?: string;
}

export const statusColors: Record<
  DisplayPolicy["status"],
  { bg: string; text: string; border: string }
> = {
  Active: { bg: "#052e16", text: "#4ade80", border: "#166534" },
  Pending: { bg: "#1c1002", text: "#fbbf24", border: "#78350f" },
  Lapsed: { bg: "#2d0a0a", text: "#f87171", border: "#7f1d1d" },
};

const LINE_STYLES: Record<
  string,
  { icon: LucideIcon; iconColor: string; iconBg: string }
> = {
  auto: { icon: Car, iconColor: "#3b82f6", iconBg: "#1e3a5f" },
  home: { icon: Home, iconColor: "#10b981", iconBg: "#052e16" },
  umbrella: { icon: Umbrella, iconColor: "#8b5cf6", iconBg: "#1e1b4b" },
  life: { icon: Heart, iconColor: "#ec4899", iconBg: "#3b0a2a" },
  landlord: { icon: Building2, iconColor: "#f59e0b", iconBg: "#1c1002" },
};

const DEFAULT_STYLE = {
  icon: Shield,
  iconColor: "#94a3b8",
  iconBg: "#1e293b",
};

/**
 * Normalize the free-text `policyStatus` from the migrated records into the
 * three buckets the cards can render. Unknown values fall back to the policy's
 * `active` flag.
 */
function toCardStatus(policy: PolicySummary): DisplayPolicy["status"] {
  const raw = (policy.policyStatus ?? "").toLowerCase();
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
