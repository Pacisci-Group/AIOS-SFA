import { LEAD_STATUSES, LEAD_TEMPERATURE_OPTIONS } from "@sfa/shared";
import type { MultiSelectOption } from "@/components/common/MultiSelect";

/**
 * Shape of every server-side filter the Leads page can apply.
 *
 * `status` and `temperature` are multi-select: an empty array means "any", and
 * several values are ORed together by the API.
 */
export interface LeadFilters {
  status: string[];
  temperature: string[];
  leadSource: string;
  producerId: string;
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_LEAD_FILTERS: LeadFilters = {
  status: [],
  temperature: [],
  leadSource: "",
  producerId: "",
  dateFrom: "",
  dateTo: "",
};

/** Canonical labels double as values — the API filters by label. */
export const LEAD_STATUS_OPTIONS: MultiSelectOption[] = LEAD_STATUSES.map(
  (status) => ({ value: status, label: status }),
);

export const LEAD_TEMPERATURE_FILTER_OPTIONS: MultiSelectOption[] =
  LEAD_TEMPERATURE_OPTIONS.map((temperature) => ({
    value: temperature,
    label: temperature,
  }));

/**
 * Radix `SelectItem` cannot take an empty string value (it reserves `""` to mean
 * "cleared"), so the "any" option carries this sentinel and is mapped back to
 * `""` before it reaches the query. Only the remaining single-value selects
 * (lead source, producer) need it.
 */
export const ANY_OPTION = "__any";

export const toFilterValue = (value: string) =>
  value === ANY_OPTION ? "" : value;

export const toSelectValue = (value: string) => value || ANY_OPTION;

/**
 * How many facets are narrowing the list, for the "N active" badge. A facet
 * counts once however many values it holds.
 */
export function countActiveFilters(filters: LeadFilters): number {
  return Object.values(filters).filter((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  ).length;
}
