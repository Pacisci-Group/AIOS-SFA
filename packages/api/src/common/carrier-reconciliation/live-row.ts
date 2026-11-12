/**
 * The filter every write to a reconciliation row carries: the row is still
 * its run's live copy.
 *
 * A re-upload of the same report period replaces the current run in one
 * transaction, which stamps `supersededAt` on each of the old run's rows
 * before it copies their decisions to the new ones. A write to an old row
 * either lands before that stamp — and is copied — or waits for the
 * transaction and then matches nothing, so it is refused instead of lost.
 *
 * `null` also matches a row stored before the field existed.
 */
export const LIVE_ROW = { supersededAt: null } as const;
