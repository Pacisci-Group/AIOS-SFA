import {
  LEAD_SOURCE_LABELS,
  LEAD_SOURCE_NONE,
  LEAD_STATUSES,
  LEAD_TEMPERATURE_OPTIONS,
} from '@sfa/shared';
import { useCallback, useMemo } from 'react';
import { useUrlState } from '@/hooks/useUrlState';
import {
  EMPTY_LEAD_FILTERS,
  type LeadFilters,
} from './components/lead-filters';

export type LeadsScope = 'own' | 'agency';

/** Widest view the toggle offers; the API still clamps it to the caller's `DataScope`. */
const DEFAULT_SCOPE: LeadsScope = 'agency';

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Param names mirror `ListLeadsParams` one-for-one, so a URL reads the same as
 * the request it produces. Frozen at module scope so `useUrlState`'s memo
 * dependencies stay stable across renders.
 */
const DEFAULTS = {
  search: '',
  status: [] as string[],
  temperature: [] as string[],
  leadSource: '',
  producerId: '',
  dateFrom: '',
  dateTo: '',
  scope: DEFAULT_SCOPE as string,
  page: '',
};

const ALLOWED = {
  status: LEAD_STATUSES,
  temperature: LEAD_TEMPERATURE_OPTIONS,
  // `LEAD_SOURCE_NONE` is a real choice in the filter ("No source"), not an
  // absent value, so it belongs in the vocabulary.
  leadSource: [...LEAD_SOURCE_LABELS, LEAD_SOURCE_NONE],
  producerId: (value: string) => OBJECT_ID.test(value),
  dateFrom: (value: string) => ISO_DATE.test(value),
  dateTo: (value: string) => ISO_DATE.test(value),
  scope: ['own', 'agency'] as const,
  page: (value: string) => /^[1-9]\d*$/.test(value),
} as const;

export interface LeadsUrlState {
  search: string;
  filters: LeadFilters;
  scope: LeadsScope;
  /** 1-based; `?page=1` is left out of the URL. */
  page: number;
  setSearch: (value: string) => void;
  patchFilters: (patch: Partial<LeadFilters>) => void;
  setScope: (scope: LeadsScope) => void;
  setPage: (page: number) => void;
  clearFilters: () => void;
}

/**
 * The Leads list's search, filters, scope and page — held in the URL rather
 * than `useState`.
 *
 * The URL is the single source of truth, which is what makes the list
 * survivable: opening a lead and hitting back restores exactly the view the
 * producer left, a refresh keeps it, and a filtered list can be pasted to
 * someone else. Held in component state it was lost on every navigation.
 *
 * Every change to *what* is being asked for resets to page 1 — otherwise a
 * narrower result set strands the user on a page that no longer exists. Done in
 * the same write as the change itself, so the old page number never reaches the
 * query (two writes in one tick would lose one; see `useUrlState`).
 */
export function useLeadsUrlState(): LeadsUrlState {
  const [values, setValues] = useUrlState({
    defaults: DEFAULTS,
    allowed: ALLOWED,
  });

  const filters = useMemo<LeadFilters>(
    () => ({
      status: values.status,
      temperature: values.temperature,
      leadSource: values.leadSource,
      producerId: values.producerId,
      dateFrom: values.dateFrom,
      dateTo: values.dateTo,
    }),
    [values],
  );

  const setSearch = useCallback(
    (search: string) => setValues({ search, page: '' }),
    [setValues],
  );

  // The filter keys are named after the URL params, so a patch is already a
  // valid update — that is the point of keeping the two vocabularies aligned.
  const patchFilters = useCallback(
    (patch: Partial<LeadFilters>) => setValues({ ...patch, page: '' }),
    [setValues],
  );

  const setScope = useCallback(
    (scope: LeadsScope) => setValues({ scope, page: '' }),
    [setValues],
  );

  const setPage = useCallback(
    (page: number) => setValues({ page: page <= 1 ? '' : String(page) }),
    [setValues],
  );

  const clearFilters = useCallback(
    () => setValues({ ...EMPTY_LEAD_FILTERS, page: '' }),
    [setValues],
  );

  return {
    search: values.search,
    filters,
    scope: values.scope as LeadsScope,
    page: Number(values.page) || 1,
    setSearch,
    patchFilters,
    setScope,
    setPage,
    clearFilters,
  };
}
