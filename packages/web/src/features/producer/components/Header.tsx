import { Search, Plus, Sun, Moon, Bell } from "lucide-react";
import { useState } from "react";

const timeFilters = ["Today", "This Week", "This Month", "Last Month", "Custom"];

interface HeaderProps {
  activeFilter: string;
  onFilterChange: (f: string) => void;
}

export function Header({ activeFilter, onFilterChange }: HeaderProps) {
  const [search, setSearch] = useState("");

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";

  return (
    <div
      className="flex flex-col gap-4 px-6 py-5"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
    >
      {/* Row 1 */}
      <div className="flex items-center gap-4">
        {/* Greeting */}
        <div className="flex-1 min-w-0">
          <h1
            className="text-[#E2E8F0] truncate"
            style={{ fontSize: "1.1rem", fontWeight: 600, letterSpacing: "-0.01em" }}
          >
            {greeting}, Justin.{" "}
            <span className="text-[#38BDF8]">Let's win today.</span>
          </h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg flex-1 max-w-sm" style={{ background: "#1E2B44", border: "1px solid rgba(255,255,255,0.07)" }}>
          <Search size={14} className="text-[#64748B] shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search leads, clients, or policy types..."
            className="bg-transparent text-[#E2E8F0] text-sm placeholder:text-[#4B5563] flex-1 outline-none min-w-0"
          />
          <kbd className="text-[10px] text-[#4B5563] hidden sm:block">⌘K</kbd>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button className="relative p-2 rounded-lg text-[#64748B] hover:text-[#94A3B8] hover:bg-white/5 transition-all">
            <Bell size={16} />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full" style={{ background: "#F59E0B" }} />
          </button>
          <button
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all hover:brightness-110 active:scale-95"
            style={{
              background: "linear-gradient(135deg, #38BDF8, #0EA5E9)",
              color: "#0B0F19",
              fontWeight: 600,
              boxShadow: "0 0 20px rgba(56,189,248,0.25)",
            }}
          >
            <Plus size={15} />
            Add New Lead
          </button>
        </div>
      </div>

      {/* Row 2 — Temporal filter */}
      <div className="flex items-center gap-1 w-fit rounded-lg p-1" style={{ background: "#111827" }}>
        {timeFilters.map((f) => {
          const isActive = activeFilter === f;
          return (
            <button
              key={f}
              onClick={() => onFilterChange(f)}
              className="px-3 py-1.5 rounded-md text-xs transition-all duration-150"
              style={{
                background: isActive ? "#1E2B44" : "transparent",
                color: isActive ? "#38BDF8" : "#64748B",
                fontWeight: isActive ? 600 : 400,
                border: isActive ? "1px solid rgba(56,189,248,0.2)" : "1px solid transparent",
              }}
            >
              {f === "Custom" ? "📅 Custom Date" : f}
            </button>
          );
        })}
      </div>
    </div>
  );
}
