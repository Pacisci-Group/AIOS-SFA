import { KpiCard } from "@/components/common/KpiCard";
import { DetailCard } from "@/components/common/DetailCard";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ReconciliationRunDetail } from "@/lib/carrier-reconciliation-api";
import { cn } from "@/lib/utils";
import {
  formatCount,
  formatMoney,
  formatRate,
} from "../reconciliation-format";

/**
 * The run's headline figures — the data team's "Summary" tab, as cards. The
 * last card also counts the open rows handed to someone, and of those, the
 * ones whose assignee has an outcome under way (PAC-173 PR 4).
 */
export function RunKpis({ run }: { run: ReconciliationRunDetail }) {
  const totals = run.totals;
  if (!totals) return null;
  // "12 rows still need a decision · 5 assigned, 2 under way".
  const assigned =
    run.assigned > 0
      ? ` · ${formatCount(run.assigned)} assigned${
          run.inProgress > 0 ? `, ${formatCount(run.inProgress)} under way` : ""
        }`
      : "";
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      <KpiCard
        label="New policies in Dash"
        value={formatCount(totals.dashSales)}
        caption={`${formatMoney(totals.dashPremium)} written · ${formatCount(totals.ignored)} other lines`}
        isPending={false}
      />
      <KpiCard
        label="Captured in the app"
        value={formatRate(totals.captureRate)}
        caption={`${formatCount(totals.matched)} matched by policy number`}
        isPending={false}
      />
      <KpiCard
        label="Missing from the app"
        value={formatCount(totals.missing)}
        caption={`${formatMoney(totals.missingPremium)} written premium`}
        isPending={false}
      />
      <KpiCard
        label="Not in Dash"
        value={formatCount(totals.appOnly)}
        caption={`${formatMoney(totals.appOnlyPremium)} in the app`}
        isPending={false}
      />
      <KpiCard
        label="1-800 to review"
        value={formatCount(totals.review1800)}
        caption={`${formatCount(run.openReviews)} rows still need a decision${assigned}`}
        isPending={false}
        className="col-span-2 lg:col-span-1"
      />
    </div>
  );
}

/**
 * One line per producer Dash credits: capture rate and what is missing. A
 * click filters the rows below to that producer; clicking it again clears it.
 */
export function ProducerTable({
  run,
  selected,
  onSelect,
}: {
  run: ReconciliationRunDetail;
  selected: string;
  onSelect: (producerKey: string) => void;
}) {
  return (
    <DetailCard
      title="By producer"
      titleHint="Who bound each new policy in Dash — the person whose Bind ID it is, by their name in the app — against what the app recorded. 1-800 policies are left out: they are nobody's to capture."
      bodyless
    >
      {run.byProducer.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          No new policies in this report.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Producer</TableHead>
              <TableHead className="text-right">In Dash</TableHead>
              <TableHead className="text-right">Matched</TableHead>
              <TableHead className="text-right">Missing</TableHead>
              <TableHead className="text-right">Missing premium</TableHead>
              <TableHead className="text-right">Not in Dash</TableHead>
              <TableHead className="text-right">Credit differs</TableHead>
              <TableHead className="pr-5 text-right">Captured</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {run.byProducer.map((producer) => {
              const active = selected === producer.producerKey;
              return (
                <TableRow
                  key={producer.producerKey}
                  data-state={active ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => onSelect(active ? "" : producer.producerKey)}
                >
                  <TableCell className="pl-5">
                    <Button
                      variant="link"
                      className="h-auto p-0 text-base text-card-foreground"
                      aria-pressed={active}
                    >
                      {producer.name}
                    </Button>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(producer.dashSales)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(producer.matched)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      producer.missing > 0 && "font-medium text-destructive",
                    )}
                  >
                    {formatCount(producer.missing)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(producer.missingPremium)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(producer.appOnly)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(producer.mismatches)}
                  </TableCell>
                  <TableCell className="pr-5 text-right tabular-nums">
                    {formatRate(producer.captureRate)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </DetailCard>
  );
}
