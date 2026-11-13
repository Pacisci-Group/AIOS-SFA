import { dbBackupSnapshotRequested } from './db-backup.events';

/**
 * Inngest validates incoming events — the operator's `curl`, and the
 * dashboard's Invoke — against this schema before the function runs, and a
 * failure there is non-retriable. These pin what an operator may send.
 */
const schema = dbBackupSnapshotRequested.schema;
const accepts = (data: unknown) => schema.safeParse(data).success;

describe('db-backup/snapshot.requested.v1', () => {
  /** A curl straight to the event API has no outbox row behind it. */
  it('accepts a request without an eventLogId', () => {
    expect(accepts({ reason: 'manual' })).toBe(true);
    expect(accepts({ reason: 'manual', label: 'before-pac-180' })).toBe(true);
    expect(
      accepts({
        reason: 'pre-deploy',
        label: '3f9c2ab',
        eventLogId: undefined,
      }),
    ).toBe(true);
  });

  it('accepts a null label', () => {
    expect(accepts({ reason: 'manual', label: null })).toBe(true);
  });

  /**
   * Rejected here means rejected before the handler: a request can never turn
   * into a rotated weekly run, so nobody can push the real weekly archives out
   * by hand — an Invoke with empty data included (verified against the dev
   * server: it fails validation and mails the failure).
   */
  it('requires a reason, and only an ad-hoc one', () => {
    expect(accepts({})).toBe(false);
    expect(accepts({ label: 'x' })).toBe(false);
    expect(accepts({ reason: 'scheduled' })).toBe(false);
    expect(accepts({ reason: 'weekly' })).toBe(false);
  });

  it('bounds the label', () => {
    expect(accepts({ reason: 'manual', label: 'x'.repeat(201) })).toBe(false);
  });
});
