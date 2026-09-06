import type { MailerImportRejection } from "@sfa/shared";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount } from "../campaign-format";

/**
 * Rows the importer would not take, and why.
 *
 * ⚠ A **sample**, not the list — the engine keeps the first handful so a
 * 20,000-row file cannot put 20,000 reasons on a campaign document. `total` is
 * the real count, which is why it is stated separately rather than inferred
 * from `rejections.length`; showing five rows next to a heading that implied
 * five skips would misreport a run that skipped hundreds.
 */
export function RejectionsTable({
  rejections,
  total,
}: {
  rejections: MailerImportRejection[];
  /** The real skip count. `null` when nothing has computed one yet. */
  total: number | null;
}) {
  if (rejections.length === 0) return null;

  return (
    <Card>
      <CardContent className="px-5 py-4">
        <h3 className="mb-1 text-sm font-semibold text-card-foreground">
          Skipped rows
        </h3>
        <p className="mb-3 text-sm text-muted-foreground">
          {total == null || total <= rejections.length
            ? `${formatCount(rejections.length)} in total.`
            : `Showing ${formatCount(rejections.length)} of ${formatCount(total)}.`}
        </p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Row</TableHead>
                <TableHead>Control number</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rejections.map((rejection, index) => (
                <TableRow key={`${rejection.row}-${index}`}>
                  <TableCell className="tabular-nums">
                    {rejection.row > 0 ? rejection.row : "—"}
                  </TableCell>
                  <TableCell>{rejection.controlNumber ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {rejection.reason}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
