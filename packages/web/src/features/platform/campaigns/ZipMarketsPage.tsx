import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
  deleteZipMarket,
  listZipMarkets,
  upsertZipMarkets,
  zipMarketsKey,
  zipMarketsListKey,
  type ZipMarketEntry,
} from "@/lib/platform-zip-markets-api";
import { SuperAdminLayout } from "../SuperAdminLayout";

const PAGE_SIZE = 50;
const ZIP5 = /^\d{5}$/;

/**
 * The ZIP → market table (PAC-71) — what replaced ApexReports' Google Sheet.
 *
 * A ZIP decides the market, and the market decides the local-presence phone
 * number printed on the piece, so an unmapped ZIP is a mail piece carrying the
 * wrong number. Most entries arrive through a campaign preview's inline
 * resolver; this page is for the bulk edit and the correction.
 *
 * ⚠ **Platform-global.** A campaign can serve many agencies, so during a preview
 * no single agency owns the resolution. The rows carry an `agencyId` column so
 * per-agency overrides are additive later — nothing here writes one.
 */
export default function ZipMarketsPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [zip5, setZip5] = useState("");
  const [market, setMarket] = useState("");
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  const debouncedQ = useDebouncedValue(q);
  const params = { page, pageSize: PAGE_SIZE, q: debouncedQ || undefined };

  const { data, isPending, isFetching } = useQuery({
    queryKey: zipMarketsListKey(params),
    queryFn: () => listZipMarkets(params),
    placeholderData: keepPreviousData,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: zipMarketsKey });

  const upsert = useMutation({
    mutationFn: (entries: ZipMarketEntry[]) => upsertZipMarkets(entries),
    onSuccess: (result, entries) => {
      toast.success(
        `${(result.upserted + result.updated).toLocaleString()} of ${entries.length.toLocaleString()} saved.`,
      );
      void invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteZipMarket(id),
    onSuccess: () => void invalidate(),
    onError: (error: Error) => toast.error(error.message),
  });

  const addOne = () => {
    if (!ZIP5.test(zip5.trim()) || !market.trim()) return;
    upsert.mutate([{ zip5: zip5.trim(), market: market.trim() }], {
      onSuccess: () => {
        setZip5("");
        setMarket("");
      },
    });
  };

  const savePaste = () => {
    const { entries, error } = parsePaste(paste);
    setPasteError(error);
    if (error || entries.length === 0) return;
    upsert.mutate(entries, { onSuccess: () => setPaste("") });
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  return (
    <SuperAdminLayout>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2 gap-1">
        <Link to="/admin/campaigns">
          <ArrowLeft className="size-4" />
          All campaigns
        </Link>
      </Button>

      <div className="mb-6">
        <h2 className="text-sm font-semibold text-card-foreground">
          ZIP → market table
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A ZIP decides the market, and the market decides the local-presence
          phone number printed on the piece. Unmapped ZIPs fall back to the
          campaign's default market.
        </p>
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <label
                htmlFor="zip5"
                className="text-[10px] tracking-widest text-muted-foreground uppercase"
              >
                ZIP
              </label>
              <Input
                id="zip5"
                value={zip5}
                onChange={(e) => setZip5(e.target.value)}
                placeholder="74011"
                inputMode="numeric"
                maxLength={5}
                className="border-border bg-card"
              />
            </div>
            <div className="flex-[2] space-y-1.5">
              <label
                htmlFor="market"
                className="text-[10px] tracking-widest text-muted-foreground uppercase"
              >
                Market
              </label>
              <Input
                id="market"
                value={market}
                onChange={(e) => setMarket(e.target.value)}
                placeholder="Tulsa"
                className="border-border bg-card"
                onKeyDown={(e) => {
                  if (e.key === "Enter") addOne();
                }}
              />
            </div>
            <Button
              className="gap-1"
              disabled={
                upsert.isPending || !ZIP5.test(zip5.trim()) || !market.trim()
              }
              onClick={addOne}
            >
              <Plus className="size-4" />
              Add
            </Button>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="paste"
              className="text-[10px] tracking-widest text-muted-foreground uppercase"
            >
              Or paste a block
            </label>
            <Textarea
              id="paste"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={4}
              placeholder={"74011,Tulsa\n73013,Oklahoma City"}
              className="border-border bg-card font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              One <code>zip,market</code> per line. Tabs work too, so a
              spreadsheet column pastes straight in. At most 1,000 rows per save.
            </p>
            {pasteError && (
              <p className="text-xs text-destructive">{pasteError}</p>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={upsert.isPending || paste.trim() === ""}
              onClick={savePaste}
            >
              {upsert.isPending && <Loader2 className="size-4 animate-spin" />}
              Save the block
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Search by ZIP or market…"
          className="border-border bg-card pl-9"
          aria-label="Search ZIP mappings"
        />
      </div>

      {isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
          {debouncedQ
            ? "No ZIPs match that search."
            : "The table is empty — run the core seed to load it."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">ZIP</TableHead>
                <TableHead>Market</TableHead>
                <TableHead className="w-28">Source</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="tabular-nums">{row.zip5}</TableCell>
                  <TableCell>{row.market}</TableCell>
                  <TableCell>
                    <Badge size="sm" variant="outline">
                      {row.source}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${row.zip5}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(row.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm tabular-nums text-muted-foreground">
          {total.toLocaleString()} mappings
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isFetching}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </SuperAdminLayout>
  );
}

/**
 * Turn a pasted block into entries, or say which line is wrong.
 *
 * ⚠ **Exactly five digits, never zero-padded to fit.** The seed source carries a
 * four-digit typo (`4031`, which should be `74031`), and padding it would map
 * `04031` — Freeport, Maine — to Tulsa. The same rule the DTO and the schema
 * both enforce; stated here so the operator sees the line number rather than a
 * 400.
 */
function parsePaste(raw: string): {
  entries: ZipMarketEntry[];
  error: string | null;
} {
  const entries: ZipMarketEntry[] = [];

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const [index, line] of lines.entries()) {
    const [zip, ...rest] = line.split(/[,\t;]/);
    const market = rest.join(",").trim();
    if (!ZIP5.test(zip?.trim() ?? "")) {
      return {
        entries: [],
        error: `Line ${index + 1}: "${zip ?? ""}" is not a 5-digit ZIP.`,
      };
    }
    if (!market) {
      return { entries: [], error: `Line ${index + 1}: no market.` };
    }
    entries.push({ zip5: zip.trim(), market });
  }

  if (entries.length > 1000) {
    return {
      entries: [],
      error: `${entries.length.toLocaleString()} rows — at most 1,000 per save.`,
    };
  }

  return { entries, error: null };
}
