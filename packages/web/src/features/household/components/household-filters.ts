import { HOUSEHOLD_STATUSES } from "@sfa/shared";
import type { MultiSelectOption } from "@/components/common/MultiSelect";
import type { HouseholdMatch } from "@/lib/households-api";

/**
 * Every server-side filter the Clients list can apply, beside the omni box.
 *
 * These five identifier fields **AND** together — they are for a caller who
 * already knows which identifier they are holding. The omni box is separate and
 * ORs across all of them; see `ListHouseholdsParams`.
 */
export interface HouseholdFilters {
  firstName: string;
  lastName: string;
  /** `YYYY-MM-DD` */
  dateOfBirth: string;
  householdRef: string;
  policyNumber: string;
  /** Multi-select: empty means "any", several values are ORed by the API. */
  status: string[];
}

export const EMPTY_HOUSEHOLD_FILTERS: HouseholdFilters = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  householdRef: "",
  policyNumber: "",
  status: [],
};

/** Canonical labels double as values — the API filters by label. */
export const HOUSEHOLD_STATUS_OPTIONS: MultiSelectOption[] =
  HOUSEHOLD_STATUSES.map((status) => ({ value: status, label: status }));

export const HOUSEHOLD_SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "policies", label: "Most policies" },
  { value: "updated", label: "Recently updated" },
] as const;

export type HouseholdSort = (typeof HOUSEHOLD_SORT_OPTIONS)[number]["value"];

/**
 * How many facets are narrowing the list, for the "N active" badge. A facet
 * counts once however many values it holds.
 */
export function countActiveFilters(filters: HouseholdFilters): number {
  return Object.values(filters).filter((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  ).length;
}

/**
 * Why a household is in the results, phrased for the row.
 *
 * The search spans three collections, so a row's own name often matches nothing
 * the user typed — a policy-number search returns the household that owns it.
 * The API only sets `matchedOn` for a reason the row cannot already show.
 */
export function matchLabel(match: HouseholdMatch): string {
  switch (match.field) {
    case "policy":
      return `Policy ${match.value}`;
    case "dateOfBirth":
      return `DOB ${match.value}`;
    default:
      return `Member ${match.value}`;
  }
}

/** Active households read as current customers; anything else is muted. */
export function householdStatusClass(status: string | null): string {
  return status === "Active"
    ? "bg-success/12 text-success"
    : "bg-muted text-muted-foreground";
}

/**
 * `updatedAt` for the list's last column — `12 Mar 2026`, or the year dropped
 * when it is the current one, since most rows in an active book are this year
 * and repeating it in every cell is noise.
 */
export function formatUpdated(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}
