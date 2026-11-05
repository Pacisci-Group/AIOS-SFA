import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Wallet } from "lucide-react";
import { PAY_STATEMENTS_PAGE_SIZE } from "@sfa/shared";
import { DataPanel } from "@/components/common/DataPanel";
import { MonthPicker } from "@/components/common/MonthPicker";
import { TablePagination } from "@/components/common/TablePagination";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
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
                  <TableHead className="text-right">Net commission</TableHead>
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
                      {formatMoney(row.totals.netCommission)}
                    </TableCell>
                    <TableCell className="pr-5">
                      <StatementStatusBadge
                        status={row.status}
                        version={row.version}
                      />
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
