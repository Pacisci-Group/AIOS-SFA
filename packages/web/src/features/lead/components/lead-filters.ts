/** Shape of every server-side filter the Leads page can apply. */
export interface LeadFilters {
  status: string;
  temperature: string;
  leadSource: string;
  producerId: string;
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_LEAD_FILTERS: LeadFilters = {
  status: "",
  temperature: "",
  leadSource: "",
  producerId: "",
  dateFrom: "",
  dateTo: "",
};

/**
 * Radix `SelectItem` cannot take an empty string value (it reserves `""` to mean
 * "cleared"), so the "any" option carries this sentinel and is mapped back to
 * `""` before it reaches the query.
 */
export const ANY_OPTION = "__any";

export const toFilterValue = (value: string) =>
  value === ANY_OPTION ? "" : value;

export const toSelectValue = (value: string) => value || ANY_OPTION;

/** Filters shown on the advanced sheet, for its "N active" badge. */
export function countActiveFilters(filters: LeadFilters): number {
  return Object.values(filters).filter(Boolean).length;
}
