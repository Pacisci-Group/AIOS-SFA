import {
  ANALYTICS_INTERVALS,
  LEAD_SOURCE_NONE,
  POLICY_TYPES,
  SALES_GROUP_BY,
  SALES_SEGMENT_BY,
  SERVICE_GROUP_BY,
  type AnalyticsInterval,
  type OwnerDashboardRangeKey,
  type SalesGroupBy,
  type SalesSegmentBy,
  type ServiceGroupBy,
} from "@sfa/shared";
import { useCallback, useMemo } from "react";
import { useUrlState } from "@/hooks/useUrlState";
import type {
  SalesFilterParams,
  ServiceFilterParams,
} from "@/lib/analytics-api";
import { parseUrlRange, toUrlRange, type UrlRange } from "@/lib/date-range";
import { SALES_TREND_METRICS, SALES_METRICS, SERVICE_METRICS } from "../analytics-format";
import type { SalesTrendMetric } from "../analytics-format";
import { ANALYTICS_RANGE_KEYS, intervalForRange } from "./analytics-range";

export type AnalyticsRange = UrlRange<OwnerDashboardRangeKey>;
export type AnalyticsTab = "sales" | "service";

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const isId = (value: string) => OBJECT_ID.test(value);

/** Every key the page owns. Frozen so `useUrlState`'s memo stays stable. */
const DEFAULTS = {
  view: "",
  range: "mtd",
  from: "",
  to: "",
  branchId: "",
  producerIds: [] as string[],
  leadSourceIds: [] as string[],
  policyTypes: [] as string[],
  carriers: [] as string[],
  assigneeIds: [] as string[],
  // How the panels are cut — part of the URL so a view can be sent to someone.
  groupBy: "",
  segmentBy: "",
  metric: "",
  compare: "",
  interval: "",
  trendMetric: "",
  trendSegmentBy: "",
  serviceGroupBy: "",
  serviceMetric: "",
};

const ALLOWED = {
  view: ["sales", "service"],
  range: ANALYTICS_RANGE_KEYS,
  branchId: isId,
  producerIds: isId,
  leadSourceIds: (value: string) => value === LEAD_SOURCE_NONE || isId(value),
  policyTypes: POLICY_TYPES,
  carriers: (value: string) => value.trim().length > 0 && value.length <= 80,
  assigneeIds: isId,
  groupBy: SALES_GROUP_BY,
  segmentBy: SALES_SEGMENT_BY,
  metric: SALES_METRICS.map((metric) => metric.key),
  compare: ["1"],
  interval: ANALYTICS_INTERVALS,
  trendMetric: SALES_TREND_METRICS.map((metric) => metric.key),
  trendSegmentBy: SALES_SEGMENT_BY,
  serviceGroupBy: SERVICE_GROUP_BY,
  serviceMetric: SERVICE_METRICS.map((metric) => metric.key),
} as const;

/** The panels' cut of the data, resolved to defaults. */
export interface AnalyticsView {
  tab: AnalyticsTab;
  groupBy: SalesGroupBy;
  segmentBy: SalesSegmentBy | null;
  metric: (typeof SALES_METRICS)[number]["key"];
  compare: boolean;
  interval: AnalyticsInterval;
  trendMetric: SalesTrendMetric;
  trendSegmentBy: SalesSegmentBy | null;
  serviceGroupBy: ServiceGroupBy;
  serviceMetric: (typeof SERVICE_METRICS)[number]["key"];
}

/**
 * The Analytics page's whole state, in the URL (PAC-152, part 2): the period,
 * the filters both tabs share, and how each panel is cut. A view survives a
 * refresh and can be sent to someone; filtering is instant, with no Apply.
 *
 * The two tabs share the period and the branch. The rest is per tab: sales
 * filter by producer, lead source and carrier; tickets by assignee.
 */
export function useAnalyticsFilters() {
  const [values, setValues] = useUrlState({ defaults: DEFAULTS, allowed: ALLOWED });

  const range = useMemo<AnalyticsRange>(
    () => parseUrlRange(values, "mtd"),
    [values],
  );

  const salesParams = useMemo<SalesFilterParams>(
    () => ({
      range: range.key,
      from: range.from,
      to: range.to,
      branchId: values.branchId,
      producerIds: values.producerIds,
      leadSourceIds: values.leadSourceIds,
      policyTypes: values.policyTypes,
      carriers: values.carriers,
    }),
    [range, values.branchId, values.producerIds, values.leadSourceIds, values.policyTypes, values.carriers],
  );

  const serviceParams = useMemo<ServiceFilterParams>(
    () => ({
      range: range.key,
      from: range.from,
      to: range.to,
      branchId: values.branchId,
      assigneeIds: values.assigneeIds,
      policyTypes: values.policyTypes,
    }),
    [range, values.branchId, values.assigneeIds, values.policyTypes],
  );

  const view = useMemo<AnalyticsView>(() => {
    const groupBy = (values.groupBy || "producer") as SalesGroupBy;
    const segmentBy = (values.segmentBy || null) as SalesSegmentBy | null;
    return {
      tab: (values.view || "sales") as AnalyticsTab,
      groupBy,
      // A split by the dimension the rows already are is no split.
      segmentBy: segmentBy === groupBy ? null : segmentBy,
      metric: (values.metric || "premium") as AnalyticsView["metric"],
      compare: values.compare === "1",
      interval: (values.interval || intervalForRange(range)) as AnalyticsInterval,
      trendMetric: (values.trendMetric || "premium") as SalesTrendMetric,
      trendSegmentBy: (values.trendSegmentBy || null) as SalesSegmentBy | null,
      serviceGroupBy: (values.serviceGroupBy || "category") as ServiceGroupBy,
      serviceMetric: (values.serviceMetric || "opened") as AnalyticsView["serviceMetric"],
    };
  }, [values, range]);

  const setRange = useCallback(
    // A new period resets the grain to the one that period reads best at.
    (next: AnalyticsRange) => setValues({ ...toUrlRange(next), interval: "" }),
    [setValues],
  );

  const activeCount =
    (values.branchId ? 1 : 0) +
    values.policyTypes.length +
    (view.tab === "sales"
      ? values.producerIds.length +
        values.leadSourceIds.length +
        values.carriers.length
      : values.assigneeIds.length);

  const clearFilters = useCallback(
    () =>
      setValues({
        branchId: "",
        producerIds: [],
        leadSourceIds: [],
        policyTypes: [],
        carriers: [],
        assigneeIds: [],
      }),
    [setValues],
  );

  return {
    values,
    setValues,
    range,
    setRange,
    salesParams,
    serviceParams,
    view,
    activeCount,
    clearFilters,
  };
}

export type AnalyticsFilters = ReturnType<typeof useAnalyticsFilters>;
