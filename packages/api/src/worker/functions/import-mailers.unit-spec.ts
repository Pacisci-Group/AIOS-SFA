import { Readable } from 'stream';
import { ImportMailersFn } from './import-mailers.fn';

/**
 * Regression cover for the stream wiring in `parseAndImport`.
 *
 * The defect this guards: `body.pipe(parser)` does not forward a source error
 * to its destination. When object storage aborted a `GetObject` response
 * mid-file — which it does to any client that stops reading for ~30s, and a
 * slow write batch is exactly that — the CSV parser was told nothing: no
 * `error`, no `end`. The `for await` inside `importMailerRows` then waited on a
 * row that could never arrive, so `handle()` never settled, its `catch` never
 * ran, the run sat in `importing` for ever and Inngest's `retries` never
 * engaged. A hung job is strictly worse than a failed one because nothing
 * downstream can see it.
 *
 * Every assertion here is about *settling*, not about counts — a test that only
 * checked the happy path would have passed against the broken code.
 */
const HEADER = 'controlno,New Control Number,firstname\n';
const row = (n: number) =>
  `#d3d00000-aaaa-aaaa-f00d-${String(n).padStart(12, '0')},${String(n).padStart(12, '0')},Ada\n`;

/** A body that emits some valid CSV and then dies the way an aborted S3 read does. */
function abortingBody(rowsBefore: number): Readable {
  let sent = 0;
  return new Readable({
    read() {
      if (sent === 0) this.push(HEADER);
      if (sent < rowsBefore) {
        this.push(row(sent));
        sent += 1;
        return;
      }
      this.destroy(new Error('aborted'));
    },
  });
}

function healthyBody(rows: number): Readable {
  return Readable.from([
    HEADER,
    ...Array.from({ length: rows }, (_, i) => row(i)),
  ]);
}

function buildFn(body: Readable) {
  /** Every `status` the handler wrote to the run, in order. */
  const statuses: (string | undefined)[] = [];
  const runModel = {
    updateOne: (_filter: unknown, update: { $set?: { status?: string } }) => {
      statuses.push(update.$set?.status);
      return Promise.resolve({});
    },
    findById: jest.fn().mockReturnValue({
      select: () => ({
        lean: () => Promise.resolve({ uploadedFilename: 'f.csv' }),
      }),
    }),
  };
  const mailerModel = {
    bulkWrite: jest
      .fn()
      .mockResolvedValue({ upsertedCount: 0, modifiedCount: 0 }),
  };
  const agencyModel = {
    findById: jest.fn().mockReturnValue({
      select: () => ({ lean: () => Promise.resolve(null) }),
    }),
  };
  const storage = { getObjectStream: jest.fn().mockResolvedValue(body) };

  const fn = new ImportMailersFn(
    {} as never,
    storage as never,
    mailerModel as never,
    runModel as never,
    agencyModel as never,
  );
  return { fn, statuses, mailerModel };
}

/** `step.run` reduced to "call the body" — the seam the handler is built around. */
const step = {
  run: <T>(_id: string, body: () => Promise<T> | T) => Promise.resolve(body()),
};

const event = {
  name: 'mailers/import.commit.requested.v1',
  data: {
    eventLogId: 'log-1',
    importRunId: 'run-1',
    agencyId: 'agency-1',
    storageKey: 'agencies/agency-1/mailer-imports/2026/file.csv',
    requestedBy: 'user-1',
  },
};

describe('ImportMailersFn — aborted object-storage read', () => {
  it('rejects instead of hanging when the source stream dies mid-file', async () => {
    const { fn } = buildFn(abortingBody(50));

    await expect(fn.handle(event, step, 'commit')).rejects.toThrow('aborted');
  });

  it('records the run as failed so the operator is not left on a spinner', async () => {
    const { fn, statuses } = buildFn(abortingBody(50));

    await expect(fn.handle(event, step, 'commit')).rejects.toThrow();

    expect(statuses).toContain('importing');
    expect(statuses).toContain('failed');
  });

  it('still consumes a healthy stream to the end', async () => {
    // The counterpart assertion: `pipeline` must not truncate the parser's
    // buffered rows when the source ends normally.
    const { fn } = buildFn(healthyBody(120));

    await expect(fn.handle(event, step, 'commit')).resolves.toMatchObject({
      read: 120,
      skipped: 0,
    });
  });
});
