import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The Prev/Next block under a paginated table (PAC-101).
 *
 * Five files rendered this independently, each with its own copy of the same
 * `Showing X to Y of Z` arithmetic and the same
 * `disabled={page <= 1 || isFetching}` pair. Disabling on `isFetching` is the
 * detail worth keeping deliberately: without it, a second click while the page
 * is still loading skips a page.
 *
 * ⚠ The **summary always renders** and only the buttons are guarded on
 * `totalPages > 1`. Four of the five call sites did exactly that — the
 * `totalPages > 1 &&` guard sat around the buttons, not the row — so hiding the
 * whole block on a single page would have quietly removed the record count from
 * every unpaginated result. Nothing renders only when there is nothing to
 * count.
 */
export interface TablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Disables both buttons while a page is in flight. */
  busy?: boolean;
  /** What the rows are called, for the summary — "records", "leads", "people". */
  noun?: string;
  className?: string;
}

export function TablePagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  busy = false,
  noun,
  className,
}: TablePaginationProps) {
  if (total === 0) return null;

  const firstRow = (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span className="text-sm tabular-nums text-muted-foreground">
        Showing {firstRow.toLocaleString()} to {lastRow.toLocaleString()} of{" "}
        {total.toLocaleString()}
        {noun ? ` ${noun}` : ""}
      </span>
      <div
        className="flex items-center gap-2"
        hidden={totalPages <= 1}
      >
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || busy}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages || busy}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
