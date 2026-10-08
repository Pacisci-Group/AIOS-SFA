import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DetailCard } from "@/components/common/DetailCard";
import type { DataExportDatasetDescriptor } from "@/lib/data-export-api";
import { COLUMN_TYPE_LABELS } from "../export-format";

/**
 * The data dictionary for one dataset, straight from the API — the headers
 * an Alteryx flow binds to, in file order, with what each one holds.
 */
export function ColumnPreview({
  dataset,
}: {
  dataset: DataExportDatasetDescriptor;
}) {
  return (
    <DetailCard
      title="Columns"
      action={
        <Badge variant="secondary" className="tabular-nums">
          {dataset.columns.length}
        </Badge>
      }
      subheading={
        <p className="mt-1 text-xs text-muted-foreground">
          In file order. Lists are joined with "; ". Dates and times are UTC
          unless the description says the agency's calendar.
        </p>
      }
      bodyless
    >
      <ScrollArea className="h-80">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-56">Column</TableHead>
              <TableHead className="w-28">Type</TableHead>
              <TableHead className="hidden sm:table-cell">Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dataset.columns.map((column) => (
              <TableRow key={column.key}>
                <TableCell className="align-top">
                  <span className="font-mono text-xs">{column.key}</span>
                  {/* Narrow screens: the description sits under the name
                      rather than in a third column squeezed to a sliver. */}
                  <p className="mt-1 text-xs whitespace-normal text-muted-foreground sm:hidden">
                    {column.description}
                  </p>
                </TableCell>
                <TableCell className="align-top">
                  <Badge variant="outline">{COLUMN_TYPE_LABELS[column.type]}</Badge>
                </TableCell>
                <TableCell className="hidden align-top text-sm whitespace-normal text-muted-foreground sm:table-cell">
                  {column.description}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </DetailCard>
  );
}
