interface PaginationFooterProps {
  /** 1-based. */
  page: number;
  totalPages: number;
  /** Rows on the current page — the "Showing 9–16" numerator. */
  pageCount: number;
  /** Rows across every page. */
  total: number;
  onChange: (page: number) => void;
  /** What the rows are, for the screen-reader label. Defaults to "results". */
  label?: string;
}

/**
 * "Showing 9–16 of 706", with Prev/Next.
 *
 * Extracted because there were two copies and PAC-98 was about to make it
 * four. `RenewalOutreachDesk` already carried a comment saying its footer
 * "mirrors `PriorityTicketQueue`'s deliberately", which is the point at which
 * a shared component is cheaper than the discipline of keeping copies in step.
 *
 * Presentational only: it knows nothing about where the rows come from, so the
 * same footer serves the client-paged renewal desk and the server-paged ticket
 * queue without either having to care.
 *
 * **Renders nothing on a single page.** A footer that can only say "1 / 1" is
 * chrome, and every surface using this is short on vertical room.
 */
export function PaginationFooter({
  page,
  totalPages,
  pageCount,
  total,
  onChange,
  label = 'results',
}: PaginationFooterProps) {
  if (totalPages <= 1) return null;

  const start = (page - 1) * Math.max(pageCount, 1);

  return (
    <nav
      aria-label={`${label} pagination`}
      className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-white/8 px-5 py-3"
    >
      <span className="text-[11px] text-muted-foreground tabular-nums">
        Showing {start + 1}–{start + pageCount} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="rounded-md border border-white/8 bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-secondary disabled:hover:text-muted-foreground"
        >
          Prev
        </button>
        <span className="px-1 text-[11px] text-muted-foreground tabular-nums">
          {page} / {totalPages}
        </span>
        <button
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="rounded-md border border-white/8 bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-secondary disabled:hover:text-muted-foreground"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
