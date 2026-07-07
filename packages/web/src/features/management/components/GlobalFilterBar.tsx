import { ChevronDown, SlidersHorizontal } from "lucide-react";

type FilterState = {
  producer: string;
  leadSource: string;
  lineOfBusiness: string;
  dateRange: string;
};

type GlobalFilterBarProps = {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
};

const PRODUCERS = ["All Producers", "Sarah Mitchell", "David Chen", "Marcus Johnson", "Ashley Rivera", "Tom Kowalski", "Priya Patel"];
const LEAD_SOURCES = ["All Sources", "Digital Leads", "Direct Mailers", "Local Sub-agents", "Referrals", "Walk-in"];
const LINES = ["All Lines", "Auto", "Home", "Umbrella", "Landlord", "Commercial"];
const DATE_RANGES = ["This Month", "Last Month", "Last 3 Months", "YTD", "Last Year"];

type SelectChipProps = {
  label: string;
  value: string;
  options: string[];
  onChange: (val: string) => void;
};

function SelectChip({ label, value, options, onChange }: SelectChipProps) {
  return (
    <div className="relative inline-flex items-center gap-1.5">
      <span style={{ color: "var(--muted-foreground)", fontSize: "11px", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>
        {label}
      </span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            appearance: "none",
            WebkitAppearance: "none",
            background: "var(--secondary)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            color: value.startsWith("All") ? "var(--muted-foreground)" : "var(--foreground)",
            fontSize: "13px",
            fontWeight: 500,
            fontFamily: "var(--font-sans)",
            padding: "5px 28px 5px 10px",
            cursor: "pointer",
            outline: "none",
            minWidth: "140px",
            transition: "border-color 0.15s",
          }}
          onFocus={(e) => (e.target.style.borderColor = "var(--emerald)")}
          onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
        >
          {options.map((opt) => (
            <option key={opt} value={opt} style={{ background: "#1e293b", color: "#f1f5f9" }}>
              {opt}
            </option>
          ))}
        </select>
        <ChevronDown
          size={12}
          style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "var(--muted-foreground)", pointerEvents: "none" }}
        />
      </div>
    </div>
  );
}

export function GlobalFilterBar({ filters, onChange }: GlobalFilterBarProps) {
  const update = (key: keyof FilterState) => (val: string) => onChange({ ...filters, [key]: val });

  const hasActiveFilters =
    !filters.producer.startsWith("All") ||
    !filters.leadSource.startsWith("All") ||
    !filters.lineOfBusiness.startsWith("All");

  return (
    <div
      style={{
        background: "var(--card)",
        borderBottom: "1px solid var(--border)",
        padding: "10px 24px",
        display: "flex",
        alignItems: "center",
        gap: "20px",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--muted-foreground)" }}>
        <SlidersHorizontal size={14} />
        <span style={{ fontSize: "11px", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 700 }}>Filters</span>
      </div>

      <div style={{ width: "1px", height: "20px", background: "var(--border)" }} />

      <SelectChip label="Producer" value={filters.producer} options={PRODUCERS} onChange={update("producer")} />
      <SelectChip label="Lead Source" value={filters.leadSource} options={LEAD_SOURCES} onChange={update("leadSource")} />
      <SelectChip label="Line of Business" value={filters.lineOfBusiness} options={LINES} onChange={update("lineOfBusiness")} />

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
        {hasActiveFilters && (
          <button
            onClick={() => onChange({ producer: "All Producers", leadSource: "All Sources", lineOfBusiness: "All Lines", dateRange: filters.dateRange })}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--emerald)",
              fontSize: "12px",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: "var(--radius-sm)",
              fontFamily: "var(--font-sans)",
            }}
          >
            Clear filters
          </button>
        )}
        <div style={{ display: "flex", gap: "4px" }}>
          {DATE_RANGES.map((d) => (
            <button
              key={d}
              onClick={() => update("dateRange")(d)}
              style={{
                background: filters.dateRange === d ? "var(--emerald)" : "var(--secondary)",
                color: filters.dateRange === d ? "#fff" : "var(--muted-foreground)",
                border: `1px solid ${filters.dateRange === d ? "var(--emerald)" : "var(--border)"}`,
                borderRadius: "var(--radius-sm)",
                padding: "4px 10px",
                fontSize: "12px",
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "var(--font-sans)",
                transition: "all 0.15s",
              }}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
