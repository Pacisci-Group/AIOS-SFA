import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/leads-api";
import {
  getUnlinkedCounts,
  listUnlinked,
  UNLINKED_RECORD_KINDS,
  type UnlinkedContactRow,
  type UnlinkedCounts,
  type UnlinkedHouseholdRow,
  type UnlinkedPolicyRow,
  type UnlinkedRecordKind,
  type UnlinkedRecordsResponse,
} from "@/lib/unlinked-api";
import { formatUpdated, householdStatusClass } from "./household-filters";

const PAGE_SIZE = 50;

/**
 * What each list is, and what the reader is expected to do about it.
 *
 * Spelled out on the page rather than left to the chip label, because "280
 * contacts" is a number nobody can act on without knowing which 280 — and
 * because two of the three have **no in-app fix yet**, which the view exists to
 * make visible rather than to paper over (PAC-91 §10).
 */
const KIND_COPY: Record<
  UnlinkedRecordKind,
  { label: string; blurb: string; empty: string }
> = {
  policies: {
    label: "Policies",
    blurb:
      "Policies that belong to no household. Open one to see it in full — assigning it to a household is not an in-app action yet.",
    empty: "Every policy belongs to a household.",
  },
  contacts: {
    label: "Contacts",
    blurb:
      "People who are not a current member of any household. Add them from the household's “+ Member” dialog; there is no way to attach this exact record yet.",
    empty: "Every contact belongs to a household.",
  },
  households: {
    label: "Households",
    blurb:
      "Households with no primary contact. Open one and use Change on the primary-contact block — a household with no members needs one added first.",
    empty: "Every household has a primary contact.",
  },
};

interface UnlinkedRecordsProps {
  kind: UnlinkedRecordKind;
  onKindChange: (kind: UnlinkedRecordKind) => void;
  page: number;
  onPageChange: (page: number) => void;
}

/**
 * The **Unlinked records** work list (PAC-91 §10).
 *
 * David's answer to "what about the records the link backfill cannot repair"
 * was: leave them unlinked, but give the team a list. This is that list and
 * deliberately no more — three counts, three tables, and a row that opens the
 * record where the existing actions live. It builds **no new action of its
 * own**: where linking a record has no UI yet, the view's job is to make that
 * gap visible, which is why the blurbs above say so out loud.
 */
export function UnlinkedRecords({
  kind,
  onKindChange,
  page,
  onPageChange,
}: UnlinkedRecordsProps) {
  // Its own query: the three chips show all three counts whichever list is
  // open, so they must not refetch every time the page changes.
  const countsQuery = useQuery({
    queryKey: ["unlinked-counts"],
    queryFn: getUnlinkedCounts,
  });

  const listQuery = useQuery({
    queryKey: ["unlinked", kind, page],
    queryFn: () => listUnlinked({ kind, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const data = listQuery.data;
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(page * PAGE_SIZE, total);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {UNLINKED_RECORD_KINDS.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={option === kind ? "default" : "outline"}
            onClick={() => onKindChange(option)}
            aria-pressed={option === kind}
          >
            {KIND_COPY[option].label}
            <span
              className={cn(
                "ml-1.5 tabular-nums",
                option === kind ? "opacity-80" : "text-muted-foreground",
              )}
            >
              {countLabel(countsQuery.data, option)}
            </span>
          </Button>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">{KIND_COPY[kind].blurb}</p>

      {listQuery.isError ? (
        <EmptyCard>
          <AlertCircle size={22} className="text-destructive" />
          <p className="text-sm text-muted-foreground">
            Couldn't load unlinked records.
          </p>
          <Button variant="outline" size="sm" onClick={() => listQuery.refetch()}>
            Retry
          </Button>
        </EmptyCard>
      ) : !listQuery.isPending && total === 0 ? (
        <EmptyCard>
          <p className="text-sm text-muted-foreground">
            {KIND_COPY[kind].empty}
          </p>
          <p className="text-xs text-muted-foreground">
            Nothing here needs linking by hand.
          </p>
        </EmptyCard>
      ) : (
        <>
          <UnlinkedTable data={data} isPending={listQuery.isPending} />

          {!listQuery.isPending && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                Showing {firstRow} to {lastRow} of {total}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || listQuery.isFetching}
                    onClick={() => onPageChange(Math.max(1, page - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages || listQuery.isFetching}
                    onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** `—` until the counts land, so the chip does not shift width twice. */
function countLabel(
  counts: UnlinkedCounts | undefined,
  kind: UnlinkedRecordKind,
): string {
  return counts ? String(counts[kind]) : "—";
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center rounded-xl bg-card border border-border">
      {children}
    </div>
  );
}

/** Column template per kind — the row renderers below follow it exactly. */
const GRID: Record<UnlinkedRecordKind, string> = {
  policies: "1.4fr 1fr 1fr 110px 110px 24px",
  contacts: "1.4fr 1.2fr 1fr 110px 24px",
  households: "1.6fr 100px 90px 110px 1fr 24px",
};

const HEADERS: Record<UnlinkedRecordKind, string[]> = {
  policies: ["Policy", "Type", "Carrier", "Premium", "Added", ""],
  contacts: ["Name", "Email", "Phone", "Added", ""],
  households: ["Household", "Status", "Policies", "Members", "Location", ""],
};

/**
 * One table for all three kinds. CSS-grid rows rather than the `Table`
 * primitive, matching `HouseholdsTable` and `LeadsTable`; the `min-w` +
 * `overflow-x-auto` pair lets it scroll inside its own card instead of crushing
 * columns on a narrow viewport.
 */
function UnlinkedTable({
  data,
  isPending,
}: {
  data: UnlinkedRecordsResponse | undefined;
  isPending: boolean;
}) {
  const kind = data?.kind ?? "policies";
  const cols = GRID[kind];
  const headers = HEADERS[kind];

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px] rounded-xl overflow-hidden bg-card border border-border">
        <div
          className="grid px-5 py-2.5 gap-3 text-xs font-medium uppercase tracking-wide text-muted-foreground border-b border-border"
          style={{ gridTemplateColumns: cols }}
        >
          {headers.map((header, i) => (
            <span key={header || `spacer-${i}`}>{header}</span>
          ))}
        </div>

        {isPending || !data
          ? Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="grid px-5 py-3.5 gap-3 items-center border-b border-border"
                style={{ gridTemplateColumns: cols }}
              >
                {headers.map((header, col) => (
                  <Skeleton
                    key={header || `spacer-${col}`}
                    className="h-3 w-24"
                  />
                ))}
              </div>
            ))
          : renderRows(data)}
      </div>
    </div>
  );
}

/** Narrowed on the response's own `kind`, not on the query that produced it. */
function renderRows(data: UnlinkedRecordsResponse) {
  const last = data.items.length - 1;
  switch (data.kind) {
    case "policies":
      return data.items.map((row, i) => (
        <PolicyRow key={row.id} row={row} divider={i < last} />
      ));
    case "contacts":
      return data.items.map((row, i) => (
        <ContactRow key={row.id} row={row} divider={i < last} />
      ));
    case "households":
      return data.items.map((row, i) => (
        <HouseholdRow key={row.id} row={row} divider={i < last} />
      ));
  }
}

const rowClass = (divider: boolean) =>
  cn(
    "relative grid px-5 py-3.5 gap-3 items-center transition-colors",
    divider && "border-b border-border",
  );

function PolicyRow({
  row,
  divider,
}: {
  row: UnlinkedPolicyRow;
  divider: boolean;
}) {
  return (
    <div
      className={cn(rowClass(divider), "hover:bg-muted/50")}
      style={{ gridTemplateColumns: GRID.policies }}
    >
      <span className="min-w-0">
        {/* Stretched link: the whole row is clickable while the policy number
            stays the one real, focusable target. */}
        <Link
          to={`/policies/${row.id}`}
          className="block text-base text-foreground font-medium truncate after:absolute after:inset-0 after:content-['']"
        >
          {row.policyNumber ?? "No policy number"}
        </Link>
        <span className="text-xs text-muted-foreground">
          {row.policyStatus ?? "Unknown status"}
        </span>
      </span>
      <span className="text-sm text-muted-foreground truncate">
        {row.policyType ?? "—"}
      </span>
      <span className="text-sm text-muted-foreground truncate">
        {row.carrier ?? "—"}
      </span>
      <span className="text-sm text-muted-foreground tabular-nums">
        {row.premium ? `$${row.premium.toLocaleString("en-US")}` : "—"}
      </span>
      <span className="text-sm text-muted-foreground tabular-nums">
        {formatUpdated(row.createdAt)}
      </span>
      <ChevronRight className="size-4 text-muted-foreground justify-self-end" />
    </div>
  );
}

/**
 * A contact row is **not** a link, and that is the honest rendering: there is no
 * contact page, and no UI attaches an existing contact to a household. A row
 * that looked clickable and went nowhere would be worse than one that does not.
 */
function ContactRow({
  row,
  divider,
}: {
  row: UnlinkedContactRow;
  divider: boolean;
}) {
  const name = [row.firstName, row.lastName].filter(Boolean).join(" ");
  return (
    <div
      className={rowClass(divider)}
      style={{ gridTemplateColumns: GRID.contacts }}
    >
      <span className="min-w-0">
        <span className="block text-base text-foreground font-medium truncate">
          {name || "Unnamed contact"}
        </span>
        {row.deceasedAt && (
          <span className="text-xs text-muted-foreground">Deceased</span>
        )}
      </span>
      <span className="text-sm text-muted-foreground truncate">
        {row.email ?? "—"}
      </span>
      <span className="text-sm text-muted-foreground truncate">
        {formatPhone(row.phone)}
      </span>
      <span className="text-sm text-muted-foreground tabular-nums">
        {formatUpdated(row.createdAt)}
      </span>
      <span />
    </div>
  );
}

function HouseholdRow({
  row,
  divider,
}: {
  row: UnlinkedHouseholdRow;
  divider: boolean;
}) {
  return (
    <div
      className={cn(rowClass(divider), "hover:bg-muted/50")}
      style={{ gridTemplateColumns: GRID.households }}
    >
      <span className="min-w-0">
        <Link
          to={`/clients/${row.id}`}
          className="block text-base text-foreground font-medium truncate after:absolute after:inset-0 after:content-['']"
        >
          {row.name ?? "Unnamed household"}
        </Link>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {row.householdRef && (
            <span className="tabular-nums">{row.householdRef}</span>
          )}
          {/* Somebody *decided* this one has no primary contact (PAC-91 §7).
              Still work — the answer is a member nobody has named yet — but a
              different kind from a household nobody has looked at. */}
          {row.dataQuality === "no_primary" && (
            <span className="text-primary">Left without a primary</span>
          )}
        </span>
      </span>

      <Badge
        size="sm"
        className={cn("w-fit font-semibold", householdStatusClass(row.status))}
      >
        {row.status ?? "Unknown"}
      </Badge>

      <span className="text-sm text-muted-foreground tabular-nums">
        {row.totalActivePolicies}
      </span>

      {/* The one number that says which job this row is: pick somebody out of
          the roster, or add a member before anybody can be picked. */}
      <span
        className={cn(
          "text-sm tabular-nums",
          row.memberCount === 0 ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {row.memberCount === 0 ? "No members" : row.memberCount}
      </span>

      <span className="text-sm text-muted-foreground truncate">
        {[row.city, row.state].filter(Boolean).join(", ") || "—"}
      </span>

      <ChevronRight className="size-4 text-muted-foreground justify-self-end" />
    </div>
  );
}
