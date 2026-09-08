import { HOUSEHOLD_STATUSES, UNLINKED_RECORD_KINDS } from "@sfa/shared";
import type { UnlinkedRecordKind } from "@sfa/shared";
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
  /*
   * Which tab is open, and which unlinked kind it is showing (PAC-91 §10).
   *
   * In the URL like everything else on this page: the Unlinked list is a work
   * queue two people share, so "the 59 households with no primary contact" has
   * to be a link somebody can paste. `page` is shared with the main list
   * because switching tab or kind resets it either way.
   */
  view: "all" as string,
  kind: "policies" as string,
};

const ALLOWED = {
  status: HOUSEHOLD_STATUSES,
  // Shape-checked here as well as by the API: a hand-edited or stale URL should
  // render the default view rather than round-trip into a 400.
  dateOfBirth: (value: string) => ISO_DATE.test(value),
  sort: ["name", "policies", "updated"] as const,
  page: (value: string) => /^[1-9]\d*$/.test(value),
  view: ["all", "unlinked"] as const,
  kind: UNLINKED_RECORD_KINDS,
} as const;

export type HouseholdsView = "all" | "unlinked";

export interface HouseholdsUrlState {
  /** Which tab: the whole book, or the unlinked work list (PAC-91 §10). */
  view: HouseholdsView;
  /** Which unlinked list the Unlinked tab is showing. */
  kind: UnlinkedRecordKind;
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
  setView: (view: HouseholdsView) => void;
  setKind: (kind: UnlinkedRecordKind) => void;
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

  const setView = useCallback(
    (view: HouseholdsView) => setValues({ view, page: "" }),
    [setValues],
  );

  const setKind = useCallback(
    (kind: UnlinkedRecordKind) => setValues({ kind, page: "" }),
    [setValues],
  );

  return {
    view: values.view as HouseholdsView,
    kind: values.kind as UnlinkedRecordKind,
    search: values.q,
    filters,
    sort: values.sort as HouseholdSort,
    page: Number(values.page) || 1,
    setSearch,
    patchFilters,
    setSort,
    setPage,
    clearFilters,
    setView,
    setKind,
  };
}
