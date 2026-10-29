import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getAssignedReconciliationRow,
  reconciliationAssignedRowKey,
  type ReconciliationAssignedRowDetail,
} from "@/lib/carrier-reconciliation-api";
import { apiErrorStatus } from "./reconciliation-format";

export interface HeldAssignedRow {
  /** The row as it was when the form opened; `null` until it is in. */
  row: ReconciliationAssignedRowDetail | null;
  /** Still waiting for the row. */
  loading: boolean;
  /** 404: the row is no longer the caller's — reassigned, or taken back. */
  gone: boolean;
  /** Any other failure, with its retry. */
  error: Error | null;
  retry: () => void;
}

/**
 * One of the caller's assigned Dash rows, read once for a form session — the
 * New Lead and Sold forms of a Dash row's sale (PAC-173). Read through the
 * drawer's own key, so the drawer's last word (an outcome just started) is
 * what the form opens on.
 *
 * **Held across refetches**, with the previous-render idiom
 * `useSelectedAssignedRow` uses. A form is a session: a row that changes under
 * it — decided by the owner while the rep hunts for the PDF — must not swap a
 * half-entered form for a block. The API judges the row again when the form is
 * sent, so holding it costs nothing.
 *
 * **Only a fresh copy is held.** A cached one past its `staleTime` waits for
 * the refetch a mount makes, so a row reached again from an old tab is read as
 * it is now — by then its outcome may have the lead this form would otherwise
 * create a second time.
 *
 * **Held against the id asked for**, not the id that comes back: after a
 * re-upload the API answers an old id with the row's copy on the new run, which
 * has an id of its own. The URL's id still works everywhere it is sent — the
 * lead and sale hooks follow it to that copy too.
 */
export function useHeldAssignedRow(
  rowId: string,
  enabled: boolean,
): HeldAssignedRow {
  const active = enabled && Boolean(rowId);
  const query = useQuery({
    queryKey: reconciliationAssignedRowKey(rowId),
    queryFn: () => getAssignedReconciliationRow(rowId),
    enabled: active,
    retry: false,
  });

  const [held, setHeld] = useState<{
    askedId: string;
    row: ReconciliationAssignedRowDetail;
  } | null>(null);
  const fresh = query.isFetchedAfterMount || !query.isStale;
  if (query.data && fresh && held?.askedId !== rowId) {
    setHeld({ askedId: rowId, row: query.data });
  }

  const row = active && held?.askedId === rowId ? held.row : null;
  // A refetch that fails after the row is held changes nothing, and a cached
  // failure is not reported while its retry is in flight.
  const failure = row || query.isFetching ? null : query.error;
  const gone = apiErrorStatus(failure) === 404;
  return {
    row,
    loading: active && !row && !failure,
    gone,
    error: gone ? null : failure,
    retry: () => void query.refetch(),
  };
}
