import { Search, Bell } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { AddLeadButton } from "@/components/leads/AddLeadButton";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RANGE_CHIPS } from "../dashboard-range";
import type { DashboardRange } from "../useDashboardRange";
import { DateRangePicker } from "./DateRangePicker";

interface HeaderProps {
  range: DashboardRange;
  onRangeChange: (next: DashboardRange) => void;
}

function deriveFirstName(
  name: string | null | undefined,
  email: string | undefined,
): string {
  const fromName = name?.trim().split(/\s+/)[0];
  if (fromName) return fromName;
  if (!email) return "there";
  const handle = email.split("@")[0] ?? "";
  const first = handle.split(/[._-]/)[0] ?? handle;
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "there";
}

export function Header({ range, onRangeChange }: HeaderProps) {
  const [search, setSearch] = useState("");
  const { user } = useAuth();

  const firstName = deriveFirstName(user?.name, user?.email);

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";

  return (
    <div className="flex flex-col gap-4 px-6 py-5 border-b border-border">
      {/* Row 1 */}
      <div className="flex items-center gap-4">
        {/* Greeting */}
        <div className="flex-1 min-w-0">
          <h1 className="text-foreground truncate text-[1.1rem] font-semibold -tracking-[0.01em]">
            {greeting}, {firstName}.{" "}
            <span className="text-primary">Let's win today.</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search leads, clients, or policy types..."
            className="pl-9 pr-12 bg-input border-border"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hidden sm:block">
            ⌘K
          </kbd>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
            <Bell size={16} />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-500" />
          </button>
          <AddLeadButton />
        </div>
      </div>

      {/* Row 2 — Temporal filter. Selection lives in the URL (PAC-9). */}
      <div className="flex items-center gap-1 w-fit rounded-lg p-1 bg-muted">
        {RANGE_CHIPS.map((chip) =>
          chip.key === "custom" ? (
            <DateRangePicker
              key={chip.key}
              range={range}
              isActive={range.key === "custom"}
              onApply={(from, to) =>
                onRangeChange({ key: "custom", from, to })
              }
            />
          ) : (
            <button
              key={chip.key}
              onClick={() => onRangeChange({ key: chip.key })}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs transition-all duration-150 border",
                range.key === chip.key
                  ? "bg-background text-primary border-primary/20 font-semibold"
                  : "bg-transparent text-muted-foreground border-transparent hover:text-foreground",
              )}
            >
              {chip.label}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
