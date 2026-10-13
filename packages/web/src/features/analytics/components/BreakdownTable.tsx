import { ColumnHead } from "@/features/owner-dashboard/components/ColumnHead";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { cn } from "@/lib/utils";
import { formatMetric, formatPct, type MetricDef } from "../analytics-format";

export interface BreakdownTableRow {
  id: string;
  label: string;
  /** One value per column, in column order. */
  cells: (number | null)[];
  share: number | null;
  /** Change of the emphasised measure against the prior period. */
  change: number | null;
}

/** Signed change, coloured by direction, with the unit spelled out. */
function Change({
  value,
  unit,
}: {
  value: number | null;
  unit: "percent" | "points";
}) {
  if (value === null) {
    return <span className="text-muted-foreground">{NOT_AVAILABLE}</span>;
  }
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return (
    <span
      className={cn(
        "tabular-nums",
        value > 0 && "text-success",
        value < 0 && "text-red-600 dark:text-red-400",
        value === 0 && "text-muted-foreground",
      )}
    >
      {sign}
      {Math.abs(value).toLocaleString("en-US")}
      {unit === "points" ? " pts" : "%"}
    </span>
  );
}

/**
 * Every row of a breakdown, with the measures the grouping supports — the
 * chart's accessible twin and the one place every row appears (the chart draws
 * the largest few).
 *
 * The emphasised measure is the one the chart draws and the rows are sorted
 * by. Wide on purpose: it scrolls sideways inside its card on a narrow screen
 * rather than pushing the page wider.
 */
export function BreakdownTable({
  caption,
  dimensionLabel,
  columns,
  rows,
  totals,
  emphasis,
  showChange,
  changeUnit,
}: {
  caption: string;
  dimensionLabel: string;
  columns: readonly MetricDef<string>[];
  rows: BreakdownTableRow[];
  totals: (number | null)[];
  /** The emphasised column's key. */
  emphasis: string;
  showChange: boolean;
  changeUnit: "percent" | "points";
}) {
  return (
    <div className="overflow-x-auto border-t border-border">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <ColumnHead label={dimensionLabel} className="pl-5" />
            {columns.map((column) => (
              <ColumnHead
                key={column.key}
                label={column.label}
                hint={column.hint}
                align="right"
                className={cn(
                  "whitespace-nowrap",
                  column.key === emphasis && "text-foreground",
                )}
              />
            ))}
            <ColumnHead
              label="Share"
              hint="This row's share of the total of the highlighted measure."
              align="right"
            />
            {showChange && (
              <ColumnHead
                label="vs prior"
                hint="Change in the highlighted measure against the comparison period."
                align="right"
                className="pr-5 whitespace-nowrap"
              />
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="max-w-56 truncate pl-5 font-medium" title={row.label}>
                {row.label}
              </TableCell>
              {columns.map((column, index) => (
                <TableCell
                  key={column.key}
                  className={cn(
                    "text-right tabular-nums",
                    column.key === emphasis ? "font-medium" : "text-muted-foreground",
                  )}
                >
                  {formatMetric(column.kind, row.cells[index])}
                </TableCell>
              ))}
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {formatPct(row.share)}
              </TableCell>
              {showChange && (
                <TableCell className="pr-5 text-right">
                  <Change value={row.change} unit={changeUnit} />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell className="pl-5 font-medium">Total</TableCell>
            {columns.map((column, index) => (
              <TableCell key={column.key} className="text-right tabular-nums">
                {formatMetric(column.kind, totals[index])}
              </TableCell>
            ))}
            <TableCell />
            {showChange && <TableCell className="pr-5" />}
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
