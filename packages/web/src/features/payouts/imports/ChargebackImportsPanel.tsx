import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { ChargebackImportSummary } from "@sfa/shared";
import { DataPanel } from "@/components/common/DataPanel";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { agencyTodayYmd } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatMonth } from "@/lib/months";
import { listChargebackImports, payoutImportsListKey } from "@/lib/payouts-api";
import { cn } from "@/lib/utils";
import { payoutErrorMessage } from "../payout-errors";
import { formatDay } from "../payout-format";
import { IMPORT_STATUS_CLASSES, IMPORT_STATUS_LABELS } from "./import-format";

/**
 * The month's chargeback reports (PAC-180), newest first — where an import
 * still in preview is picked up again. The owner's alone, like the import.
 */
export function ChargebackImportsPanel({
  month,
  timeZone,
}: {
  month: string;
  /** The agency's, for the upload day. */
  timeZone: string | undefined;
}) {
  const navigate = useNavigate();
  const imports = useQuery({
    queryKey: payoutImportsListKey(month),
    queryFn: () => listChargebackImports(month),
  });
  const rows = (imports.data?.imports ?? []).filter(
    (item) => item.status !== "discarded",
  );

  return (
    <DataPanel
      title="Chargeback reports"
      titleHint="Uploaded carrier chargeback reports for this month. A report in preview has charged nobody yet."
      isPending={imports.isPending}
      isError={imports.isError}
      isEmpty={rows.length === 0}
      emptyMessage={`No chargeback report uploaded for ${formatMonth(month)}.`}
      errorMessage={
        imports.error
          ? payoutErrorMessage(imports.error)
          : "Could not load the chargeback reports."
      }
      onRetry={() => void imports.refetch()}
      skeletonRows={2}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">File</TableHead>
            <TableHead>Carrier</TableHead>
            <TableHead className="text-right">Lines</TableHead>
            <TableHead className="text-right">To charge</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead className="pr-5">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((item) => (
            <TableRow
              key={item.id}
              className="cursor-pointer"
              tabIndex={0}
              onClick={() => navigate(`/payouts/imports/${item.id}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter")
                  navigate(`/payouts/imports/${item.id}`);
              }}
            >
              <TableCell className="max-w-64 truncate pl-5 font-medium">
                {item.filename}
              </TableCell>
              <TableCell>{item.carrier}</TableCell>
              <TableCell className="text-right tabular-nums">
                {item.counts.rows}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {chargedLabel(item)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDay(agencyTodayYmd(timeZone, new Date(item.createdAt)))}
                {item.createdByName ? ` · ${item.createdByName}` : ""}
              </TableCell>
              <TableCell className="pr-5">
                <Badge
                  size="sm"
                  variant="ghost"
                  className={cn("shrink-0", IMPORT_STATUS_CLASSES[item.status])}
                >
                  {IMPORT_STATUS_LABELS[item.status]}
                </Badge>
                {item.status === "preview" && item.counts.unmatched > 0 && (
                  <span className="ml-2 text-xs text-amber-700 dark:text-amber-500">
                    {item.counts.unmatched} need a person
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DataPanel>
  );
}

/** What was (or would be) charged: `5 · $1,234.50`. */
function chargedLabel(item: ChargebackImportSummary): string {
  if (item.status === "committed" && item.result) {
    return `${item.result.written} · ${formatMoney(item.result.amount)}`;
  }
  return `${item.counts.toCharge} · ${formatMoney(item.counts.amountToCharge)}`;
}
