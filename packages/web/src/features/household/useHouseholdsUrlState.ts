import { HOUSEHOLD_STATUSES } from "@sfa/shared";
import { useCallback, useMemo } from "react";
import { useUrlState } from "@/hooks/useUrlState";
import {
  EMPTY_HOUSEHOLD_FILTERS,
  type HouseholdFilters,
  type HouseholdSort,
} from "./components/household-filters";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Param names mirror `ListHouseholdsParams` one-for-one, so a URL reads the same
 * as the request it produces. Frozen at module scope so `useUrlState`'s memo
 * dependencies stay stable across renders.
 */
const DEFAULTS = {
  q: "",
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  householdRef: "",
  policyNumber: "",
  status: [] as string[],
  sort: "name" as string,
  page: "",
};

const ALLOWED = {
  status: HOUSEHOLD_STATUSES,
  // Shape-checked here as well as by the API: a hand-edited or stale URL should
  // render the default view rather than round-trip into a 400.
  dateOfBirth: (value: string) => ISO_DATE.test(value),
  sort: ["name", "policies", "updated"] as const,
  page: (value: string) => /^[1-9]\d*$/.test(value),
} as const;

export interface HouseholdsUrlState {
  /** The omni box. */
  search: string;
  filters: HouseholdFilters;
  sort: HouseholdSort;
  /** 1-based; `?page=1` is left out of the URL. */
  page: number;
  setSearch: (value: string) => void;
  patchFilters: (patch: Partial<HouseholdFilters>) => void;
  setSort: (sort: HouseholdSort) => void;
  setPage: (page: number) => void;
  clearFilters: () => void;
}

/**
 * The Clients list's search, filters, sort and page — held in the URL rather
 * than `useState`.
 *
 * Same reasoning as `useLeadsUrlState`: the URL is the single source of truth,
 * so opening a household and hitting back restores the view, a refresh keeps
 * it, and a filtered list can be pasted to a colleague. It matters more here
 * than on Leads — the whole point of this page is finding one record and
 * opening it, which means every user leaves and comes back.
 *
 * Every change to *what* is being asked for resets to page 1 in the same write,
 * so a narrower result set cannot strand the user on a page that no longer
 * exists (two writes in one tick would lose one; see `useUrlState`).
 */
export function useHouseholdsUrlState(): HouseholdsUrlState {
  const [values, setValues] = useUrlState({
    defaults: DEFAULTS,
    allowed: ALLOWED,
  });

  const filters = useMemo<HouseholdFilters>(
    () => ({
      firstName: values.firstName,
      lastName: values.lastName,
      dateOfBirth: values.dateOfBirth,
      householdRef: values.householdRef,
      policyNumber: values.policyNumber,
      status: values.status,
    }),
    [values],
  );

  const setSearch = useCallback(
    (q: string) => setValues({ q, page: "" }),
    [setValues],
  );

  // The filter keys are named after the URL params, so a patch is already a
  // valid update — that is the point of keeping the two vocabularies aligned.
  const patchFilters = useCallback(
    (patch: Partial<HouseholdFilters>) => setValues({ ...patch, page: "" }),
    [setValues],
  );

  const setSort = useCallback(
    (sort: HouseholdSort) => setValues({ sort, page: "" }),
    [setValues],
  );

  const setPage = useCallback(
    (page: number) => setValues({ page: page <= 1 ? "" : String(page) }),
    [setValues],
  );

  const clearFilters = useCallback(
    () => setValues({ ...EMPTY_HOUSEHOLD_FILTERS, page: "" }),
    [setValues],
  );

  return {
    search: values.q,
    filters,
    sort: values.sort as HouseholdSort,
    page: Number(values.page) || 1,
    setSearch,
    patchFilters,
    setSort,
    setPage,
    clearFilters,
  };
}
