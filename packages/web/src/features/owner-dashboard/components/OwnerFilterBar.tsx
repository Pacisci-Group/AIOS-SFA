import { LEAD_SOURCE_NONE, POLICY_TYPES } from "@sfa/shared";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useMemo } from "react";
import { MultiSelect } from "@/components/common/MultiSelect";
import { RangeChips } from "@/components/common/RangeChips";
import { Button } from "@/components/ui/button";
import { useLeadSources } from "@/hooks/useLeadSources";
import { usePermissions } from "@/hooks/usePermissions";
import type { OwnerDashboardParams } from "@/lib/owner-dashboard-api";
import { agencyUserOptionsKey, listUserOptions } from "@/lib/users-api";
import { OWNER_RANGE_CHIPS } from "../owner-range";
import type { OwnerRange } from "../useOwnerFilters";

interface OwnerFilterBarProps {
  range: OwnerRange;
  params: OwnerDashboardParams;
  onRangeChange: (next: OwnerRange) => void;
  onFilterChange: (
    key: "producerIds" | "leadSourceIds" | "policyTypes",
    next: string[],
  ) => void;
  onClear: () => void;
  activeCount: number;
}

/** Line of business = policy type — exactly the Sold form's dropdown. */
const POLICY_TYPE_OPTIONS = POLICY_TYPES.map((type) => ({
  value: type,
  label: type,
}));

/**
 * Period chips and the three multi-selects (PAC-135). Filtering is **instant** —
 * there is no Apply button — and everything lives in the URL, so a filtered view
 * survives a refresh and can be sent to someone.
 *
 * Every card and both tables react to all of it. The one exception is stated
 * where it applies rather than here: the lead-source table's Vol column cannot
 * take a line-of-business filter.
 */
export function OwnerFilterBar({
  range,
  params,
  onRangeChange,
  onFilterChange,
  onClear,
  activeCount,
}: OwnerFilterBarProps) {
  const { can } = usePermissions();
  // The agency directory is its own permission. An account can hold the
  // dashboard without it (the Data Team template does), and asking anyway would
  // only earn a 403 — so the Producer filter is simply not offered.
  const canListUsers = can("agency:users:read");

  const producersQuery = useQuery({
    queryKey: agencyUserOptionsKey,
    queryFn: listUserOptions,
    enabled: canListUsers,
    staleTime: 30 * 60_000,
  });
  const leadSourcesQuery = useLeadSources();

  const producerOptions = useMemo(
    () =>
      (producersQuery.data ?? []).map((user) => ({
        value: user._id,
        label:
          [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
          user.email,
      })),
    [producersQuery.data],
  );

  const leadSourceOptions = useMemo(
    () => [
      ...(leadSourcesQuery.data ?? []).map((source) => ({
        value: source.id,
        label: source.name,
      })),
      // A first-class choice: most of history has no source, and an owner has
      // to be able to look at exactly that.
      { value: LEAD_SOURCE_NONE, label: "No source" },
    ],
    [leadSourcesQuery.data],
  );

  return (
    <div className="flex flex-col gap-3 border-b border-border px-4 py-3 md:px-6 lg:flex-row lg:items-center lg:justify-between">
      <RangeChips
        chips={OWNER_RANGE_CHIPS}
        range={range}
        onChange={onRangeChange}
      />

      <div className="flex flex-wrap items-center gap-2">
        {canListUsers && (
          <MultiSelect
            options={producerOptions}
            value={params.producerIds}
            onChange={(next) => onFilterChange("producerIds", next)}
            placeholder="All producers"
            summarize={(count) => `${count} producers`}
            className="w-44"
          />
        )}
        <MultiSelect
          options={leadSourceOptions}
          value={params.leadSourceIds}
          onChange={(next) => onFilterChange("leadSourceIds", next)}
          placeholder="All lead sources"
          summarize={(count) => `${count} lead sources`}
          className="w-44"
        />
        <MultiSelect
          options={POLICY_TYPE_OPTIONS}
          value={params.policyTypes}
          onChange={(next) => onFilterChange("policyTypes", next)}
          placeholder="All lines of business"
          summarize={(count) => `${count} lines of business`}
          className="w-48"
          align="end"
        />
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X aria-hidden />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
