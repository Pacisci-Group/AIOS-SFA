import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { DataPanel } from "@/components/common/DataPanel";
import { KpiCard } from "@/components/common/KpiCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { formatMonth } from "@/lib/months";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { getPayoutActivity, payoutActivityKey } from "@/lib/payouts-api";
import { payoutErrorMessage } from "../payout-errors";
import { chargebackSourceLabel, formatDay } from "../payout-format";

interface ActivityPanelProps {
  /** Whose activity; omitted for the signed-in person's own. */
  userId?: string;
  month: string;
  /** Offer a link to the person's statement for the month, when there is one. */
  linkStatement?: boolean;
}

/**
 * Everything one producer or CSR sold and had charged back in a month
 * (PAC-179): the policies, the chargebacks with where each came from, and
 * the totals — for any month, statement or not. The same loader computes
 * the statements, so for a month with one the totals are its figures.
 */
export function ActivityPanel({
  userId,
  month,
  linkStatement = false,
}: ActivityPanelProps) {
  const activity = useQuery({
    queryKey: payoutActivityKey(userId ?? "me", month),
    queryFn: () => getPayoutActivity({ month, userId }),
  });
  const data = activity.data;
  const pending = activity.isPending;

  if (activity.isError) {
    return (
      <DataPanel
        title="Sales and chargebacks"
        isPending={false}
        isError
        isEmpty={false}
        emptyMessage=""
        errorMessage={payoutErrorMessage(activity.error)}
        onRetry={() => void activity.refetch()}
        skeletonRows={0}
      >
        {null}
      </DataPanel>
    );
  }

  return (
    <div className="space-y-6">
      {linkStatement && data?.statementId && (
        <Button variant="outline" size="sm" asChild>
          <Link to={`/payouts/statements/${data.statementId}`}>
            Open the {formatMonth(month)} statement
          </Link>
        </Button>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Sales"
          value={String(data?.totals.deals ?? 0)}
          caption={`${data?.totals.policies ?? 0} policies · ${data?.totals.bundles ?? 0} bundled`}
          isPending={pending}
        />
        <KpiCard
          label="Sold premium"
          value={formatMoney(data?.totals.premium ?? 0)}
          caption={formatMonth(month)}
          isPending={pending}
        />
        <KpiCard
          label="Charged back"
          value={formatMoney(data?.totals.chargebackTotal ?? 0)}
          caption={`${data?.totals.chargebacks ?? 0} chargeback${data?.totals.chargebacks === 1 ? "" : "s"}`}
          isPending={pending}
        />
      </div>

      <DataPanel
        title="Policies sold"
        isPending={pending}
        isError={false}
        isEmpty={(data?.deals.length ?? 0) === 0}
        emptyMessage={`No sales in ${formatMonth(month)}.`}
        errorMessage=""
        onRetry={() => void activity.refetch()}
        skeletonRows={4}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Sold</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Policies</TableHead>
              <TableHead>Carrier</TableHead>
              <TableHead>Lead source</TableHead>
              <TableHead className="pr-5 text-right">Premium</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.deals.map((deal) => (
              <TableRow key={deal.dealId}>
                <TableCell className="pl-5 tabular-nums text-muted-foreground">
                  {formatDay(deal.soldDay)}
                </TableCell>
                <TableCell className="max-w-56 truncate">
                  {deal.clientName}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>
                      {deal.policyTypes.length
                        ? deal.policyTypes.join(", ")
                        : NOT_AVAILABLE}
                    </span>
                    {deal.isBundle && (
                      <Badge variant="secondary" size="sm">
                        Bundle
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {deal.carriers.length
                    ? deal.carriers.join(", ")
                    : NOT_AVAILABLE}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {deal.leadSourceName ?? NOT_AVAILABLE}
                </TableCell>
                <TableCell className="pr-5 text-right tabular-nums">
                  {formatMoney(deal.premium)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          {data && data.deals.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell className="pl-5 font-semibold" colSpan={5}>
                  Total
                </TableCell>
                <TableCell className="pr-5 text-right font-semibold tabular-nums">
                  {formatMoney(data.totals.premium)}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </DataPanel>

      <DataPanel
        title="Chargebacks"
        isPending={pending}
        isError={false}
        isEmpty={(data?.chargebacks.length ?? 0) === 0}
        emptyMessage={`Nothing was charged back in ${formatMonth(month)}.`}
        errorMessage=""
        onRetry={() => void activity.refetch()}
        skeletonRows={2}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Date</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Policy number</TableHead>
              <TableHead>Carrier</TableHead>
              <TableHead>Policy type</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="pr-5 text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.chargebacks.map((row) => (
              <TableRow key={row.chargebackId}>
                <TableCell className="pl-5 tabular-nums text-muted-foreground">
                  {formatDay(row.occurredDay)}
                </TableCell>
                <TableCell className="max-w-56 truncate">
                  {row.customerName ?? NOT_AVAILABLE}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.policyNumber ?? NOT_AVAILABLE}
                </TableCell>
                <TableCell>{row.carrier}</TableCell>
                <TableCell>{row.policyType ?? NOT_AVAILABLE}</TableCell>
                <TableCell>
                  <Badge variant="outline" size="sm">
                    {chargebackSourceLabel(row)}
                  </Badge>
                </TableCell>
                <TableCell className="pr-5 text-right tabular-nums">
                  {formatMoney(row.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          {data && data.chargebacks.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell className="pl-5 font-semibold" colSpan={6}>
                  Total
                </TableCell>
                <TableCell className="pr-5 text-right font-semibold tabular-nums">
                  {formatMoney(data.totals.chargebackTotal)}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </DataPanel>
    </div>
  );
}
