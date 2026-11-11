import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Info, Wallet } from "lucide-react";
import { PAY_STATEMENTS_PAGE_SIZE, statementNetPay } from "@sfa/shared";
import { DataPanel } from "@/components/common/DataPanel";
import { MonthPicker } from "@/components/common/MonthPicker";
import { TablePagination } from "@/components/common/TablePagination";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/auth-context";
import { useUrlState } from "@/hooks/useUrlState";
import { formatMoney } from "@/lib/money";
import { agencyMonth, formatMonth, isMonth } from "@/lib/months";
import { listPayStatements, payStatementsListKey } from "@/lib/payouts-api";
import { ActivityPanel } from "./components/ActivityPanel";
import { StatementStatusBadge } from "./components/StatementStatusBadge";
import { payoutErrorMessage } from "./payout-errors";

const URL_DEFAULTS = { month: "", page: "" };
const URL_ALLOWED = {
  month: isMonth,
  page: (value: string) => /^[1-9]\d{0,4}$/.test(value),
};

/**
 * My Pay (PAC-178): the signed-in person's own commission statements, newest
 * month first, and their own sales and chargebacks for any month (PAC-179).
 *
 * **A draft is never shown here** — the API's `mine` view leaves drafts out
 * for everyone, a branch manager included. A statement appears once it has
 * been sent.
 *
 * A sent statement waits for the employee's answer (PAC-182): the page says
 * how many do, and those rows carry a Review button. The count is its own
 * one-row query on `status=sent`, so it holds whichever page of the table is
 * showing.
 */
export default function MyPayPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const currentMonth = agencyMonth(user?.timeZone);
  const [values, setValues] = useUrlState({
    defaults: URL_DEFAULTS,
    allowed: URL_ALLOWED,
  });
  const month =
    values.month && values.month <= currentMonth ? values.month : currentMonth;
  const page = Number(values.page) || 1;
  const params = { mine: true, page, pageSize: PAY_STATEMENTS_PAGE_SIZE };
  const statements = useQuery({
    queryKey: payStatementsListKey(params),
    queryFn: () => listPayStatements(params),
    placeholderData: keepPreviousData,
  });
  const data = statements.data;
  // How many wait for an answer, across every page of the table.
  const waitingParams = { mine: true, status: "sent" as const, pageSize: 1 };
  const waiting = useQuery({
    queryKey: payStatementsListKey(waitingParams),
    queryFn: () => listPayStatements(waitingParams),
  });
  const waitingCount = waiting.data?.total ?? 0;

  return (
    <AppShell>
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <MobileNav className="-ml-1" />
          <div className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-primary sm:flex">
            <Wallet aria-hidden className="size-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              My Pay
            </h1>
            <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Your commission statements
            </p>
          </div>
        </div>
      </header>

      <main className="w-full px-4 py-6 md:px-6">
        <div className="space-y-8">
          {waitingCount > 0 && (
            <Alert>
              <Info aria-hidden className="text-primary!" />
              <AlertTitle className="line-clamp-none">
                {waitingCount === 1
                  ? "1 statement is waiting for your answer"
                  : `${waitingCount} statements are waiting for your answer`}
              </AlertTitle>
              <AlertDescription>
                {waitingCount === 1
                  ? "Review it, then accept or dispute it. Accepting signs it and is final."
                  : "Review each, then accept or dispute it. Accepting signs it and is final."}
              </AlertDescription>
            </Alert>
          )}
          <DataPanel
            title="Statements"
            isPending={statements.isPending}
            isError={statements.isError}
            isEmpty={(data?.statements.length ?? 0) === 0}
            emptyMessage="No statements yet. A statement appears here once your manager has sent it."
            errorMessage={
              statements.error
                ? payoutErrorMessage(statements.error)
                : "Could not load your statements."
            }
            onRetry={() => void statements.refetch()}
            skeletonRows={3}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Month</TableHead>
                  <TableHead className="text-right">Sold premium</TableHead>
                  <TableHead className="text-right">Chargebacks</TableHead>
                  <TableHead className="text-right">Net pay</TableHead>
                  <TableHead className="pr-5">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.statements.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/payouts/statements/${row.id}`)}
                  >
                    <TableCell className="pl-5 font-medium">
                      {formatMonth(row.month)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.totals.grossPremium)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.totals.chargebackTotal)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(statementNetPay(row.totals))}
                    </TableCell>
                    <TableCell className="pr-5">
                      <div className="flex items-center gap-2">
                        <StatementStatusBadge
                          status={row.status}
                          version={row.version}
                        />
                        {row.status === "sent" && (
                          <Button size="xs" variant="outline" asChild>
                            <Link
                              to={`/payouts/statements/${row.id}`}
                              // The row navigates too; once is enough.
                              onClick={(event) => event.stopPropagation()}
                            >
                              Review
                            </Link>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data && data.totalPages > 1 && (
              <TablePagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                totalPages={data.totalPages}
                onPageChange={(next) =>
                  setValues({ page: next > 1 ? String(next) : "" })
                }
                busy={statements.isFetching}
                noun="statements"
                className="border-t border-border px-5 py-3"
              />
            )}
          </DataPanel>

          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">
                  My sales and chargebacks
                </h2>
                <p className="text-sm text-muted-foreground">
                  Everything you sold and had charged back in a month, statement
                  or not.
                </p>
              </div>
              <MonthPicker
                value={month}
                max={currentMonth}
                onChange={(next) =>
                  setValues({ month: next === currentMonth ? "" : next })
                }
              />
            </div>
            <ActivityPanel month={month} linkStatement />
          </section>
        </div>
      </main>
    </AppShell>
  );
}
