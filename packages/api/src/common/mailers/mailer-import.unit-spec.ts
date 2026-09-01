import { importMailerRows, type MailerUpsertTarget } from './mailer-import';
import type { MailerMapContext } from './mailer-row.mapper';

const ctx: MailerMapContext = {
  agencyId: 'agency-1',
  system: 'spreadsheet',
  runId: 'run-1',
  uploadedAt: new Date('2026-08-25T00:00:00Z'),
};

/** Two source rows carrying both control-number forms. */
const rows = [
  {
    controlno: '#d3d00000-aaaa-aaaa-f00d-0000bbbbbbbb',
    newcontrolnumber: '0000BBBBBBBB',
    firstname: 'Ada',
  },
  {
    controlno: '#c0ffee00-1111-2222-3333-444455556666',
    newcontrolnumber: '444455556666',
    firstname: 'Grace',
  },
];

/** The filter shape this file asserts on. */
interface RecordedFilter {
  agencyId: string;
  controlNumberKeys: { $in: string[]; $type: string };
}

function recordingModel() {
  const filters: RecordedFilter[] = [];
  const model: MailerUpsertTarget = {
    bulkWrite: (batch) => {
      for (const write of batch) {
        filters.push(write.updateOne.filter as unknown as RecordedFilter);
      }
      return Promise.resolve({ upsertedCount: batch.length, modifiedCount: 0 });
    },
  };
  return { model, filters };
}

describe('importMailerRows upsert filter', () => {
  /**
   * The regression this file exists for.
   *
   * `$type: 'string'` restates the dedupe index's `partialFilterExpression`,
   * and MongoDB only uses a partial index when the query provably implies that
   * expression. Without the clause the planner discards
   * `agencyId_1_controlNumberKeys_1`, falls back to `agencyId_1` and FETCHes
   * every mailer in the agency for every row of the file — O(n²) in the
   * collection size. It is invisible on an import into an empty collection and
   * then degrades until a batch outlives the object-storage read timeout.
   *
   * Asserted on the emitted operation rather than through a live MongoDB
   * because the failure is a *planner* decision: the query returns identical
   * results either way, so only the shape of the filter can catch it here.
   */
  it('constrains controlNumberKeys by $type so the partial dedupe index is usable', async () => {
    const { model, filters } = recordingModel();

    await importMailerRows(rows, ctx, { model });

    expect(filters).toHaveLength(2);
    for (const filter of filters) {
      expect(filter.agencyId).toBe('agency-1');
      expect(filter.controlNumberKeys.$type).toBe('string');
    }
  });

  it('still matches on either control-number form', async () => {
    const { model, filters } = recordingModel();

    await importMailerRows([rows[0]], ctx, { model });

    // Both forms, so a document already holding either one is found rather
    // than re-inserted into an E11000.
    expect(filters[0].controlNumberKeys.$in).toEqual([
      'D3D00000AAAAAAAAF00D0000BBBBBBBB',
      '0000BBBBBBBB',
    ]);
  });

  it('counts what it wrote', async () => {
    const { model } = recordingModel();

    const result = await importMailerRows(rows, ctx, { model });

    expect(result.counts).toMatchObject({ read: 2, mapped: 2, skipped: 0 });
  });

  it('writes nothing on a dry run', async () => {
    const { model, filters } = recordingModel();

    const result = await importMailerRows(
      rows,
      ctx,
      { model },
      { dryRun: true },
    );

    expect(filters).toHaveLength(0);
    expect(result.counts).toMatchObject({ read: 2, mapped: 2, created: 0 });
  });
});
