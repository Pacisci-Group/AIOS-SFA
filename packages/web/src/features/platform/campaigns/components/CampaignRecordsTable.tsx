import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { TablePagination } from "@/components/common/TablePagination";
import {
  SEARCH_DEBOUNCE_MS,
  TableSearchInput,
} from "@/components/common/TableSearchInput";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  campaignRecordsKey,
  listCampaignRecords,
} from "@/lib/platform-campaigns-api";
import { formatCount, formatMoney } from "../campaign-format";

const PAGE_SIZE = 25;

/**
 * The mailers a campaign currently owns (PAC-71).
 *
 * "Currently" is the load-bearing word: an append from a later campaign moves
 * rows out of this one, so the count here is live rather than what the import
 * wrote. Search takes **either printed control-number form** — the server
 * normalizes to the same key the drawer looks up on — or a name prefix, which
 * is the pair of questions an operator actually arrives with ("did this person
 * get a piece?", "is this control number ours?").
 */
export function CampaignRecordsTable({ campaignId }: { campaignId: string }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const debouncedQ = useDebouncedValue(q, SEARCH_DEBOUNCE_MS);

  const params = {
    page,
    pageSize: PAGE_SIZE,
    q: debouncedQ || undefined,
  };

  const { data, isPending, isFetching, isError, error, refetch } = useQuery({
    queryKey: campaignRecordsKey(campaignId, params),
    queryFn: () => listCampaignRecords(campaignId, params),
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-3">
      <TableSearchInput
        value={q}
        onValueChange={(next) => {
          setQ(next);
          // A narrower result must never strand the operator on a page that
          // no longer exists.
          setPage(1);
        }}
        placeholder="Search any column — name, control number, town, market, code…"
        label="Search campaign records"
        busy={isFetching}
      />

      {isError ? (
        /* This table used to destructure no `isError` at all, so a failed
           search rendered as an indistinguishable empty table — the one state
           where "no records match that search" is actively wrong. */
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{(error as Error).message}</span>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
          {debouncedQ
            ? "No records match that search."
            : "This campaign owns no mailers."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Control number</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Market</TableHead>
                <TableHead className="text-right">Offer</TableHead>
                <TableHead>Code</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="font-medium">
                    {record.name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{record.newControlNumber ?? "—"}</span>
                      {/* Both printed forms are stored and both are searchable;
                          the long one is what the vendor prints on some pieces. */}
                      {record.controlNumber &&
                        record.controlNumber !== record.newControlNumber && (
                          <span className="text-xs text-muted-foreground">
                            {record.controlNumber}
                          </span>
                        )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {[record.city, record.state].filter(Boolean).join(", ") ||
                      "—"}
                    {record.zip ? ` ${record.zip}` : ""}
                  </TableCell>
                  <TableCell>{record.market ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(record.premiumYearly)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">
                        {record.carrierAgencyId ?? "—"}
                      </span>
                      {record.visibleAgencyIds === null && (
                        <Badge size="sm" variant="outline">
                          All
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <TablePagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        totalPages={totalPages}
        onPageChange={setPage}
        busy={isFetching}
        noun="records"
      />
    </div>
  );
}
