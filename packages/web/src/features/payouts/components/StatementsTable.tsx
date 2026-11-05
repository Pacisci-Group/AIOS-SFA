import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import {
  PAY_STATEMENT_STATUSES,
  PAY_STATEMENTS_PAGE_SIZE,
  type PayStatementStatus,
} from "@sfa/shared";
import { DataPanel } from "@/components/common/DataPanel";
import { TablePagination } from "@/components/common/TablePagination";
import { TableSearchInput } from "@/components/common/TableSearchInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { AgencyBranch } from "@/lib/branches-api";
import { formatMoney } from "@/lib/money";
import { formatMonth } from "@/lib/months";
import { listPayStatements, payStatementsListKey } from "@/lib/payouts-api";
import { payoutErrorMessage } from "../payout-errors";
import { POOL_LABELS, STATEMENT_STATUS_LABELS } from "../payout-format";
import { StatementStatusBadge } from "./StatementStatusBadge";

/** Radix Select cannot hold `""`, so "no filter" needs a value of its own. */
const ANY = "__any__";

export interface StatementsFilter {
  status: "" | PayStatementStatus;
  branch: string;
  q: string;
  page: number;
}

/**
 * A month's statements (PAC-178), as the reviewer may see them, with the
 * filters applied as they change — no Apply button. A row opens the
 * statement.
 */
export function StatementsTable({
  month,
  filter,
  onFilterChange,
  branches,
}: {
  month: string;
  filter: StatementsFilter;
  onFilterChange: (patch: Partial<StatementsFilter>) => void;
  /** Offered to an agency-wide reviewer; `null` hides the branch filter. */
  branches: AgencyBranch[] | null;
}) {
  const navigate = useNavigate();
  const params = {
    month,
    status: filter.status || undefined,
    branchId: filter.branch || undefined,
    q: filter.q || undefined,
    page: filter.page,
    pageSize: PAY_STATEMENTS_PAGE_SIZE,
  };
  const statements = useQuery({
    queryKey: payStatementsListKey(params),
    queryFn: () => listPayStatements(params),
    placeholderData: keepPreviousData,
  });

  // The box shows what is typed; the URL (and the query) follow a beat later.
  const [search, setSearch] = useState(filter.q);
  const debounced = useDebouncedValue(search);
  useEffect(() => {
    if (debounced !== filter.q) onFilterChange({ q: debounced, page: 1 });
    // Only the debounced value drives this; `filter.q` follows from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const data = statements.data;
  const filtered = Boolean(filter.status || filter.branch || filter.q);

  return (
    <DataPanel
      title="Statements"
      subheading={
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <TableSearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Name"
            label="Search statements by name"
            busy={statements.isFetching}
            className="w-full sm:w-64"
          />
          <Select
            value={filter.status || ANY}
            onValueChange={(value) =>
              onFilterChange({
                status: value === ANY ? "" : (value as PayStatementStatus),
                page: 1,
              })
            }
          >
            <SelectTrigger
              className="w-full bg-card sm:w-44"
              aria-label="Status"
            >
              <SelectValue>
                {filter.status
                  ? STATEMENT_STATUS_LABELS[filter.status]
                  : "Any status"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any status</SelectItem>
              {PAY_STATEMENT_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {STATEMENT_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {branches && branches.length > 1 && (
            <Select
              value={filter.branch || ANY}
              onValueChange={(value) =>
                onFilterChange({ branch: value === ANY ? "" : value, page: 1 })
              }
            >
              <SelectTrigger
                className="w-full bg-card sm:w-48"
                aria-label="Branch"
              >
                <SelectValue>
                  {branches.find((branch) => branch._id === filter.branch)
                    ?.name ?? "Every branch"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Every branch</SelectItem>
                {branches.map((branch) => (
                  <SelectItem key={branch._id} value={branch._id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      }
      isPending={statements.isPending}
      isError={statements.isError}
      isEmpty={(data?.statements.length ?? 0) === 0}
      emptyMessage={
        filtered
          ? "No statements match these filters."
          : `No statements for ${formatMonth(month)}.`
      }
      errorMessage={
        statements.error
          ? payoutErrorMessage(statements.error)
          : "Could not load the statements."
      }
      onRetry={() => void statements.refetch()}
      skeletonRows={6}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="text-right">Sold premium</TableHead>
            <TableHead className="text-right">Chargebacks</TableHead>
            <TableHead className="text-right">Net premium</TableHead>
            <TableHead className="text-right">Commission</TableHead>
            <TableHead className="text-right">Bonuses</TableHead>
            <TableHead className="text-right">Net commission</TableHead>
            <TableHead className="pr-5">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.statements.map((row) => {
            const t = row.totals;
            const commission = t.grossCommission - t.chargebackImpact;
            const bonuses =
              t.tierBonus + t.teamBonus + t.somBonus + t.hatTrickBonus;
            return (
              <TableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => navigate(`/payouts/statements/${row.id}`)}
              >
                <TableCell className="pl-5">
                  <div className="flex items-center gap-1.5 font-medium">
                    {row.userName}
                    {row.warningCount > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="inline-flex">
                            <TriangleAlert
                              aria-label={`${row.warningCount} to check`}
                              className="size-4 text-amber-600 dark:text-amber-500"
                            />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {row.warningCount === 1
                            ? "One thing to check"
                            : `${row.warningCount} things to check`}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.branchName ?? row.structureName}
                  </div>
                </TableCell>
                <TableCell>{POOL_LABELS[row.pool]}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(t.grossPremium)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(t.chargebackTotal)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(t.netPremium)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(commission)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(bonuses)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatMoney(t.netCommission)}
                </TableCell>
                <TableCell className="pr-5">
                  <StatementStatusBadge
                    status={row.status}
                    version={row.version}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {data && (
        <TablePagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          totalPages={data.totalPages}
          onPageChange={(page) => onFilterChange({ page })}
          busy={statements.isFetching}
          noun="statements"
          className="border-t border-border px-5 py-3"
        />
      )}
    </DataPanel>
  );
}
