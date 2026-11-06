import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Calculator,
  FileUp,
  ListChecks,
  Loader2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import {
  AgencyPermission,
  PAY_STATEMENT_STATUSES,
  PAYOUT_RUN_GENERATING,
  type PayStatementStatus,
} from "@sfa/shared";
import { MonthPicker } from "@/components/common/MonthPicker";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { usePermissions } from "@/hooks/usePermissions";
import { useUrlState } from "@/hooks/useUrlState";
import { listBranches } from "@/lib/branches-api";
import { addMonths, agencyMonth, formatMonth, isMonth } from "@/lib/months";
import {
  generatePayoutRun,
  getPayoutRun,
  payoutRunKey,
  payStatementsKey,
} from "@/lib/payouts-api";
import { RunSummary } from "./components/RunSummary";
import { ChargebackImportsPanel } from "./imports/ChargebackImportsPanel";
import { ImportChargebacksDialog } from "./imports/ImportChargebacksDialog";
import {
  StatementsTable,
  type StatementsFilter,
} from "./components/StatementsTable";
import { payoutErrorCode, payoutErrorMessage } from "./payout-errors";

const URL_DEFAULTS = { month: "", status: "", branch: "", q: "", page: "" };
const URL_ALLOWED = {
  month: isMonth,
  status: PAY_STATEMENT_STATUSES as readonly string[],
  branch: (value: string) => /^[a-f0-9]{24}$/i.test(value),
  page: (value: string) => /^[1-9]\d{0,4}$/.test(value),
};

/**
 * Payouts (PAC-178): one month's commission statements, for the owner and
 * branch managers (`payouts:write`; the API scopes a manager to their
 * branch).
 *
 * The month defaults to the **previous** agency month — the one the
 * 1st-of-month job drafts, and what a reviewer opens the page for at the
 * start of a month. The current month can be generated too; it is partial
 * until it ends. Generate / Recalculate is the owner's
 * (`agency:payouts:admin`), and only ever rewrites draft and disputed
 * statements. So is the chargeback report (PAC-180): Upload chargebacks
 * opens its preview, and the month's reports are listed below.
 */
export default function PayoutsPage() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isAdmin = can(AgencyPermission.PayoutsAdmin);
  const [uploading, setUploading] = useState(false);
  const currentMonth = agencyMonth(user?.timeZone);
  const [values, setValues] = useUrlState({
    defaults: URL_DEFAULTS,
    allowed: URL_ALLOWED,
  });
  const month =
    values.month && values.month <= currentMonth
      ? values.month
      : addMonths(currentMonth, -1);
  const filter: StatementsFilter = {
    status: values.status as "" | PayStatementStatus,
    branch: values.branch,
    q: values.q,
    page: Number(values.page) || 1,
  };

  const run = useQuery({
    queryKey: payoutRunKey(month),
    queryFn: () => getPayoutRun(month),
    // While the job (or another tab) is computing, watch it finish.
    refetchInterval: (query) =>
      query.state.data?.run?.status === "generating" ? 3000 : false,
  });
  const agencyWide = user?.dataScope === "agency";
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: listBranches,
    enabled: agencyWide && can("agency:branches:read"),
    retry: false,
  });

  const [confirming, setConfirming] = useState(false);
  const generate = useMutation({
    mutationFn: () => generatePayoutRun(month),
    onSuccess: async (response) => {
      queryClient.setQueryData(payoutRunKey(month), response);
      await queryClient.invalidateQueries({ queryKey: payStatementsKey });
      setConfirming(false);
      const count = response.run?.counts.statements ?? 0;
      toast.success(
        `${formatMonth(month)} calculated: ${count} statement${count === 1 ? "" : "s"}.`,
      );
    },
    onError: (error) => {
      setConfirming(false);
      toast.error(
        payoutErrorCode(error) === PAYOUT_RUN_GENERATING
          ? "This month is being calculated right now. Try again in a minute."
          : payoutErrorMessage(error),
      );
    },
  });

  const existing = run.data?.run ?? null;
  const generating = existing?.status === "generating" || generate.isPending;
  const partial = month === (run.data?.currentMonth ?? currentMonth);

  return (
    <AppShell>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <MobileNav className="-ml-1" />
          <div className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-primary sm:flex">
            <Wallet aria-hidden className="size-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              Payouts
            </h1>
            <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Monthly commission statements
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker
            value={month}
            max={currentMonth}
            onChange={(next) => setValues({ month: next, page: "" })}
          />
          <Button variant="outline" size="sm" asChild>
            <Link to={`/payouts/activity?month=${month}`}>
              <ListChecks aria-hidden />
              Activity
            </Link>
          </Button>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUploading(true)}
            >
              <FileUp aria-hidden />
              Upload chargebacks
            </Button>
          )}
          {isAdmin && (
            <Button
              size="sm"
              disabled={generating || run.isPending}
              onClick={() =>
                existing ? setConfirming(true) : generate.mutate()
              }
            >
              {generating ? (
                <Loader2 aria-hidden className="animate-spin" />
              ) : (
                <Calculator aria-hidden />
              )}
              {generating
                ? "Calculating…"
                : existing
                  ? "Recalculate"
                  : "Generate"}
            </Button>
          )}
        </div>
      </header>

      <main className="w-full px-4 py-6 md:px-6">
        <div className="space-y-6">
          {run.isError ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-5 py-16 text-center">
              <AlertCircle aria-hidden className="size-5 text-destructive" />
              <p className="text-sm text-muted-foreground">
                {payoutErrorMessage(run.error)}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void run.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : run.isPending ? (
            <Skeleton className="h-32 w-full rounded-xl" />
          ) : !existing ? (
            <div className="rounded-xl border border-border bg-card px-5 py-16 text-center">
              <p className="text-sm font-medium text-card-foreground">
                No statements for {formatMonth(month)} yet.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {partial
                  ? "This month is still running. Its statements are drafted on the 1st of next month."
                  : "Statements are drafted on the 1st of the month after."}
                {isAdmin ? " You can generate them now." : ""}
              </p>
            </div>
          ) : existing.status === "generating" ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-16 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Calculating {formatMonth(month)}…
            </div>
          ) : (
            <>
              {partial && (
                <p className="text-sm text-muted-foreground">
                  {formatMonth(month)} is still running: these figures are so
                  far, and the statements are recalculated when it ends.
                </p>
              )}
              <RunSummary run={existing} partial={partial} />
              <StatementsTable
                month={month}
                filter={filter}
                onFilterChange={(patch) =>
                  setValues({
                    ...(patch.status !== undefined
                      ? { status: patch.status }
                      : {}),
                    ...(patch.branch !== undefined
                      ? { branch: patch.branch }
                      : {}),
                    ...(patch.q !== undefined ? { q: patch.q } : {}),
                    ...(patch.page !== undefined
                      ? { page: patch.page > 1 ? String(patch.page) : "" }
                      : {}),
                  })
                }
                branches={agencyWide && branches.data ? branches.data : null}
              />
            </>
          )}
          {isAdmin && (
            <ChargebackImportsPanel month={month} timeZone={user?.timeZone} />
          )}
        </div>
      </main>

      {isAdmin && (
        <ImportChargebacksDialog
          key={month}
          open={uploading}
          onOpenChange={setUploading}
          month={month}
          currentMonth={currentMonth}
          onImported={(importId) => navigate(`/payouts/imports/${importId}`)}
        />
      )}

      <AlertDialog
        open={confirming}
        onOpenChange={(next) =>
          !next && !generate.isPending && setConfirming(false)
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Recalculate {formatMonth(month)}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Draft and disputed statements are worked out again from today's
              sales, chargebacks and structures. Their adjustments are kept.
              Sent and accepted statements stay exactly as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={generate.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={generate.isPending}
              onClick={(event) => {
                event.preventDefault();
                generate.mutate();
              }}
            >
              {generate.isPending && (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              )}
              Recalculate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
