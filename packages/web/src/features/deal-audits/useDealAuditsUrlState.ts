import { useCallback, useMemo } from "react";
import {
  DEAL_AUDIT_QUEUE_SORTS,
  DEAL_AUDIT_QUEUE_STATUSES,
  POLICY_TYPES,
} from "@sfa/shared";
import type {
  DealAuditQueueRangeKey,
  DealAuditQueueSort,
  DealAuditQueueStatus,
} from "@sfa/shared";
import { useUrlState } from "@/hooks/useUrlState";
import { parseUrlRange, toUrlRange, type UrlRange } from "@/lib/date-range";
import {
  QUEUE_DEFAULT_RANGE,
  QUEUE_DEFAULT_SORT,
  QUEUE_RANGE_KEYS,
} from "./queue-filters";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** Frozen at module scope so `useUrlState`'s memo dependencies stay stable. */
const DEFAULTS = {
  status: "",
  q: "",
  producerIds: [] as string[],
  policyTypes: [] as string[],
  aging: "",
  range: QUEUE_DEFAULT_RANGE as string,
  from: "",
  to: "",
  sort: QUEUE_DEFAULT_SORT as string,
  page: "",
};

const ALLOWED = {
  status: DEAL_AUDIT_QUEUE_STATUSES as readonly string[],
  producerIds: (value: string) => OBJECT_ID.test(value),
  policyTypes: POLICY_TYPES as readonly string[],
  aging: ["true"],
  range: QUEUE_RANGE_KEYS as readonly string[],
  sort: DEAL_AUDIT_QUEUE_SORTS as readonly string[],
  page: (value: string) => /^[1-9]\d*$/.test(value),
} as const;

/** What the queue shows with no `?status=` — everything not yet approved. */
const DEFAULT_STATUS: DealAuditQueueStatus = "open";

export type DealAuditQueueRange = UrlRange<DealAuditQueueRangeKey>;

export interface DealAuditsUrlState {
  status: DealAuditQueueStatus;
  /** The raw search box; the page debounces it before asking. */
  search: string;
  producerIds: string[];
  policyTypes: string[];
  aging: boolean;
  range: DealAuditQueueRange;
  sort: DealAuditQueueSort;
  /** 1-based; `?page=1` is left out of the URL. */
  page: number;
  /** Producers, line, aging and period — one each, however many picked. */
  activeCount: number;
  setStatus: (status: DealAuditQueueStatus) => void;
  setSearch: (search: string) => void;
  setProducerIds: (ids: string[]) => void;
  setPolicyTypes: (types: string[]) => void;
  setAging: (aging: boolean) => void;
  setRange: (range: DealAuditQueueRange) => void;
  setSort: (sort: DealAuditQueueSort) => void;
  setPage: (page: number) => void;
  /** The four filters; search, sort and the status chip stay. */
  clearFilters: () => void;
}

/**
 * The Deal Audits queue's view, held in the URL (PAC-106; search, filters and
 * sort 20 Oct 2026).
 *
 * The URL is the single source of truth, so opening a deal and coming back —
 * or sending the link to someone — lands on the same view. Every change to
 * *what* is asked for resets to page 1 **in the same write**: two writes in
 * one tick lose one (see `useUrlState`).
 *
 * Aging and the Approved chip cannot both hold — an approved audit is never
 * aging — so picking Approved switches Aging off rather than showing an
 * empty page.
 */
export function useDealAuditsUrlState(): DealAuditsUrlState {
  const [values, setValues] = useUrlState({
    defaults: DEFAULTS,
    allowed: ALLOWED,
  });

  const range = useMemo(
    () => parseUrlRange<DealAuditQueueRangeKey>(values, QUEUE_DEFAULT_RANGE),
    [values],
  );
  const status = (values.status || DEFAULT_STATUS) as DealAuditQueueStatus;
  // Off under Approved, whatever the URL says — what picking that chip does,
  // so a pasted `?status=pass&aging=true` is not a pressed, disabled toggle
  // over an empty page.
  const aging = values.aging === "true" && status !== "pass";

  const setStatus = useCallback(
    (status: DealAuditQueueStatus) =>
      setValues({
        status: status === DEFAULT_STATUS ? "" : status,
        ...(status === "pass" ? { aging: "" } : {}),
        page: "",
      }),
    [setValues],
  );
  const setSearch = useCallback(
    (q: string) => setValues({ q, page: "" }),
    [setValues],
  );
  const setProducerIds = useCallback(
    (producerIds: string[]) => setValues({ producerIds, page: "" }),
    [setValues],
  );
  const setPolicyTypes = useCallback(
    (policyTypes: string[]) => setValues({ policyTypes, page: "" }),
    [setValues],
  );
  const setAging = useCallback(
    (next: boolean) => setValues({ aging: next ? "true" : "", page: "" }),
    [setValues],
  );
  const setRange = useCallback(
    (next: DealAuditQueueRange) =>
      setValues({ ...toUrlRange(next), page: "" }),
    [setValues],
  );
  const setSort = useCallback(
    (sort: DealAuditQueueSort) => setValues({ sort, page: "" }),
    [setValues],
  );
  const setPage = useCallback(
    (page: number) => setValues({ page: page <= 1 ? "" : String(page) }),
    [setValues],
  );
  const clearFilters = useCallback(
    () =>
      setValues({
        producerIds: [],
        policyTypes: [],
        aging: "",
        ...toUrlRange<DealAuditQueueRangeKey>({ key: QUEUE_DEFAULT_RANGE }),
        page: "",
      }),
    [setValues],
  );

  const activeCount =
    Number(values.producerIds.length > 0) +
    Number(values.policyTypes.length > 0) +
    Number(aging) +
    Number(range.key !== QUEUE_DEFAULT_RANGE);

  return {
    status,
    search: values.q,
    producerIds: values.producerIds,
    policyTypes: values.policyTypes,
    aging,
    range,
    sort: values.sort as DealAuditQueueSort,
    page: Number(values.page) || 1,
    activeCount,
    setStatus,
    setSearch,
    setProducerIds,
    setPolicyTypes,
    setAging,
    setRange,
    setSort,
    setPage,
    clearFilters,
  };
}
