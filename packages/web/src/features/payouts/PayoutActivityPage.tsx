import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { MonthPicker } from "@/components/common/MonthPicker";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { useUrlState } from "@/hooks/useUrlState";
import { agencyMonth, isMonth } from "@/lib/months";
import {
  listPayoutActivityPeople,
  payoutActivityPeopleKey,
} from "@/lib/payouts-api";
import { ActivityPanel } from "./components/ActivityPanel";
import { payoutErrorMessage } from "./payout-errors";

const URL_DEFAULTS = { user: "", month: "" };
const URL_ALLOWED = {
  user: (value: string) => /^[a-f0-9]{24}$/i.test(value),
  month: isMonth,
};

/**
 * Sales and chargebacks per person (PAC-179), for a reviewer: anyone in the
 * agency (owner) or their branch (branch manager), any month, statement or
 * not. The list of people comes from the API, already scoped.
 */
export default function PayoutActivityPage() {
  const { user } = useAuth();
  const currentMonth = agencyMonth(user?.timeZone);
  const [values, setValues] = useUrlState({
    defaults: URL_DEFAULTS,
    allowed: URL_ALLOWED,
  });
  const month =
    values.month && values.month <= currentMonth ? values.month : currentMonth;
  const people = useQuery({
    queryKey: payoutActivityPeopleKey,
    queryFn: listPayoutActivityPeople,
    staleTime: 60_000,
  });
  const list = people.data?.people ?? [];
  const selected = list.find((person) => person.id === values.user) ?? null;

  return (
    <AppShell>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <MobileNav className="-ml-1" />
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to={`/payouts?month=${month}`} aria-label="Back to Payouts">
              <ArrowLeft aria-hidden />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              Sales and chargebacks
            </h1>
            <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Per producer or CSR, per month
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={values.user || undefined}
            onValueChange={(next) => setValues({ user: next })}
            disabled={people.isPending || people.isError}
          >
            <SelectTrigger
              className="w-full bg-card sm:w-64"
              aria-label="Person"
            >
              <SelectValue placeholder="Choose a person">
                {selected?.name ??
                  (values.user ? "Someone not listed" : undefined)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {list.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name}
                  {person.roles.length ? ` · ${person.roles.join(", ")}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <MonthPicker
            value={month}
            max={currentMonth}
            onChange={(next) =>
              setValues({ month: next === currentMonth ? "" : next })
            }
          />
        </div>
      </header>

      <main className="w-full px-4 py-6 md:px-6">
        {people.isError ? (
          <p className="text-sm text-destructive">
            {payoutErrorMessage(people.error)}
          </p>
        ) : people.isPending ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : !values.user ? (
          <div className="rounded-xl border border-border bg-card px-5 py-16 text-center text-sm text-muted-foreground">
            Choose a person to see what they sold and had charged back.
          </div>
        ) : (
          <div className="space-y-4">
            {selected && (
              <p className="text-sm text-muted-foreground">
                {selected.name}
                {selected.branchName ? ` · ${selected.branchName}` : ""}
                {selected.status !== "active" ? ` · ${selected.status}` : ""}
              </p>
            )}
            <ActivityPanel userId={values.user} month={month} linkStatement />
          </div>
        )}
      </main>
    </AppShell>
  );
}
