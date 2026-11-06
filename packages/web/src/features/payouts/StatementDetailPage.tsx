import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Calculator, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { isEditableStatementStatus, ModuleKey } from "@sfa/shared";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { useUrlState } from "@/hooks/useUrlState";
import { formatMonth } from "@/lib/months";
import {
  getPayStatement,
  payoutRunsKey,
  payStatementKey,
  payStatementsKey,
  recalculatePayStatement,
} from "@/lib/payouts-api";
import { ActivityPanel } from "./components/ActivityPanel";
import { StatementBreakdown } from "./components/StatementBreakdown";
import { StatementInputsCard } from "./components/StatementInputsCard";
import { StatementStatusBadge } from "./components/StatementStatusBadge";
import { payoutErrorMessage } from "./payout-errors";
import { POOL_LABELS } from "./payout-format";

const TAB_DEFAULTS = { tab: "" };
const TAB_ALLOWED = { tab: ["activity"] as const };

/**
 * One commission statement (PAC-178), the same page for the reviewer and the
 * employee — the API decides who may open it (an employee only their own,
 * once sent; a 404 otherwise). The Statement tab mirrors the Commission
 * Statement's sections; Activity (PAC-179) lists the month's sales and
 * chargebacks behind it.
 *
 * A reviewer (`payouts:write`) may recalculate a draft or disputed one, and
 * enter the figures its structure needs (the compliance rate, retention, …;
 * 2026 comp plans) — not on their own statement without
 * `agency:payouts:admin`. Sending, accepting and disputing arrive with
 * PAC-181/182.
 */
export default function StatementDetailPage() {
  const { id = "" } = useParams();
  const { canWrite } = usePermissions();
  const reviewer = canWrite(ModuleKey.Payouts);
  const queryClient = useQueryClient();
  const [view, setView] = useUrlState({
    defaults: TAB_DEFAULTS,
    allowed: TAB_ALLOWED,
  });

  const statement = useQuery({
    queryKey: payStatementKey(id),
    queryFn: () => getPayStatement(id),
    enabled: Boolean(id),
  });
  const recalculate = useMutation({
    mutationFn: () => recalculatePayStatement(id),
    onSuccess: async (updated) => {
      queryClient.setQueryData(payStatementKey(id), updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: payStatementsKey }),
        queryClient.invalidateQueries({ queryKey: payoutRunsKey }),
      ]);
      toast.success("Statement recalculated.");
    },
    onError: (error) => toast.error(payoutErrorMessage(error)),
  });

  const s = statement.data;
  const backTo = reviewer && s ? `/payouts?month=${s.month}` : "/my-pay";

  return (
    <AppShell>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <MobileNav className="-ml-1" />
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to={backTo} aria-label="Back">
              <ArrowLeft aria-hidden />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {s ? s.userName : "Commission statement"}
            </h1>
            <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {s
                ? `Commission statement · ${formatMonth(s.month)} · ${POOL_LABELS[s.pool]}`
                : "Loading"}
            </p>
          </div>
          {s && <StatementStatusBadge status={s.status} version={s.version} />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            value={view.tab || "statement"}
            onValueChange={(next) =>
              setView({ tab: next === "activity" ? "activity" : "" })
            }
          >
            <TabsList>
              <TabsTrigger value="statement">Statement</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
          </Tabs>
          {reviewer && s && isEditableStatementStatus(s.status) && (
            <Button
              size="sm"
              variant="outline"
              disabled={recalculate.isPending}
              onClick={() => recalculate.mutate()}
            >
              {recalculate.isPending ? (
                <Loader2 aria-hidden className="animate-spin" />
              ) : (
                <Calculator aria-hidden />
              )}
              Recalculate
            </Button>
          )}
        </div>
      </header>

      <main className="w-full px-4 py-6 md:px-6">
        {statement.isError ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-5 py-16 text-center">
            <AlertCircle aria-hidden className="size-5 text-destructive" />
            <p className="text-sm text-muted-foreground">
              {payoutErrorMessage(statement.error)}
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link to={backTo}>Back</Link>
            </Button>
          </div>
        ) : !s ? (
          <div className="space-y-6">
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : view.tab === "activity" ? (
          <ActivityPanel userId={s.userId} month={s.month} />
        ) : (
          <StatementBreakdown
            statement={s}
            figures={<StatementInputsCard statement={s} />}
          />
        )}
      </main>
    </AppShell>
  );
}
