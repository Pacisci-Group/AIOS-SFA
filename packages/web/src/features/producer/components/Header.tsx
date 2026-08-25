import { Search, Bell } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { AddLeadButton } from "@/components/leads/AddLeadButton";
import { MobileNav } from "@/components/layout/MobileNav";
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
    <div className="flex flex-col gap-3 border-b border-border px-4 py-4 md:gap-4 md:px-6 md:py-5">
      {/*
        Row 1 wraps rather than shrinking: below `lg` the search box takes a
        line of its own (`order-last w-full`) and the greeting keeps the top
        line with the actions. `lg` and not `md`, because at 768px the sidebar
        has already taken 224px — squeezing greeting, search and actions onto
        what is left gave a 90px input that could not show its own placeholder.
      */}
      <div className="flex flex-wrap items-center gap-3 md:gap-4">
        <MobileNav className="-ml-1" />

        {/* Greeting */}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[1.1rem] font-semibold -tracking-[0.01em] text-foreground">
            {greeting}, {firstName}.{" "}
            <span className="text-primary">Let's win today.</span>
          </h1>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        {/* Search */}
        <div className="relative order-last w-full lg:order-none lg:w-auto lg:max-w-sm lg:flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search leads, clients, or policy types..."
            className="border-border bg-input pl-9 pr-12"
          />
          <kbd className="absolute top-1/2 right-3 hidden -translate-y-1/2 text-[10px] text-muted-foreground sm:block">
            ⌘K
          </kbd>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          <button className="relative rounded-lg p-2 text-muted-foreground transition-all hover:bg-muted hover:text-foreground">
            <Bell size={16} />
            <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
          </button>
          <AddLeadButton />
        </div>
      </div>

      {/* Row 2 — Temporal filter. Selection lives in the URL (PAC-9).
          Six chips are wider than a phone, so the strip scrolls sideways and
          bleeds into the page gutter to show that it does. */}
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="flex w-max items-center gap-1 rounded-lg bg-muted p-1">
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
                  "rounded-md border px-3 py-1.5 text-xs whitespace-nowrap transition-all duration-150",
                  range.key === chip.key
                    ? "border-primary/20 bg-background font-semibold text-primary"
                    : "border-transparent bg-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {chip.label}
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
