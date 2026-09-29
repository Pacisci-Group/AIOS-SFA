import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from '../helpers/test-app';

// The migration is plain CommonJS, as migrate-mongo requires — there is no ES
// module to import, so the rule is switched off for exactly this one line.
/* eslint-disable @typescript-eslint/no-require-imports */
const migration =
  require('../../migrations/20260929004500-campaign_files_array.js') as {
    up(db: unknown): Promise<void>;
    down(db: unknown): Promise<void>;
  };
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * PAC-142's `vendorFile` → `files[]` migration, driven against a real MongoDB.
 *
 * Written through the **raw driver** in the pre-PAC-142 shape, because that is
 * what a real database holds when the API boots with this file pending;
 * Mongoose would already know the new shape and there would be nothing to
 * migrate. The properties worth proving are the README's rules: a second `up`
 * is a no-op, and `down` refuses when it would lose a file.
 *
 * ⚠ e2e suites share one database — never run two at once.
 */
/** The document as the raw driver returns it, before and after the migration. */
interface StoredCampaign {
  vendorFile?: { storageKey: string; name: string; size: number } | null;
  files?: {
    _id: Types.ObjectId;
    storageKey: string;
    name: string;
    size: number;
  }[];
  newRowsFile?: unknown;
  firstImportedAt?: Date | null;
}

describe('campaign_files_array migration (e2e)', () => {
  let app: INestApplication;
  let connection: Connection;

  const collection = () =>
    connection.db!.collection<StoredCampaign>('mailerCampaigns');

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    connection = app.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    if (app) {
      await dropTestDatabase(app);
      await closeTestApp(app);
    }
  });

  beforeEach(async () => {
    await collection().deleteMany({});
  });

  it('moves the vendor file into files[] and stamps the first import', async () => {
    const finishedAt = new Date('2026-09-10T12:00:00Z');
    const imported = new Types.ObjectId();
    const previewed = new Types.ObjectId();
    const implicit = new Types.ObjectId();
    await collection().insertMany([
      {
        _id: imported,
        name: 'Week 36',
        status: 'imported',
        source: 'vendor',
        vendorFile: {
          storageKey: 'platform/mailer-campaigns/2026/vendor/a.csv',
          name: 'a.csv',
          size: 10,
          contentType: 'text/csv',
        },
        finishedAt,
        updatedAt: new Date('2026-09-11T00:00:00Z'),
      },
      {
        _id: previewed,
        name: 'Week 37',
        status: 'previewed',
        source: 'vendor',
        vendorFile: {
          storageKey: 'platform/mailer-campaigns/2026/vendor/b.csv',
          name: 'b.csv',
          size: 20,
        },
        finishedAt: null,
      },
      {
        _id: implicit,
        name: 'Migrated week',
        status: 'imported',
        source: 'migration',
        vendorFile: null,
      },
    ]);

    await migration.up(connection.db);

    const a = await collection().findOne({ _id: imported });
    expect(a?.vendorFile).toBeUndefined();
    expect(a?.files).toHaveLength(1);
    expect(a?.files?.[0]).toMatchObject({
      storageKey: 'platform/mailer-campaigns/2026/vendor/a.csv',
      name: 'a.csv',
      size: 10,
    });
    // Each file gets an id a client can name it by.
    expect(a?.files?.[0]._id).toBeInstanceOf(Types.ObjectId);
    expect(a?.newRowsFile).toBeNull();
    // It had imported: the moment is taken from `finishedAt`.
    expect(a?.firstImportedAt).toEqual(finishedAt);

    const b = await collection().findOne({ _id: previewed });
    expect(b?.files).toHaveLength(1);
    // Never imported, so nothing to lock.
    expect(b?.firstImportedAt).toBeNull();

    const c = await collection().findOne({ _id: implicit });
    expect(c?.files).toEqual([]);
    expect(c?.vendorFile).toBeUndefined();
  });

  it('is a no-op the second time', async () => {
    await collection().insertOne({
      name: 'Week 36',
      status: 'imported',
      source: 'vendor',
      vendorFile: { storageKey: 'k', name: 'a.csv', size: 1 },
      finishedAt: new Date(),
    });
    await migration.up(connection.db);
    const first = await collection().findOne({});
    await migration.up(connection.db);
    const second = await collection().findOne({});
    // Same file id: the document was not touched again.
    expect(second?.files?.[0]._id.toString()).toBe(
      first?.files?.[0]._id.toString(),
    );
  });

  it('rolls back a one-file campaign and refuses a many-file one', async () => {
    await collection().insertOne({
      name: 'Week 36',
      status: 'imported',
      source: 'vendor',
      vendorFile: { storageKey: 'k', name: 'a.csv', size: 1 },
      finishedAt: new Date(),
    });
    await migration.up(connection.db);
    await migration.down(connection.db);

    const restored = await collection().findOne({});
    expect(restored?.vendorFile).toEqual({
      storageKey: 'k',
      name: 'a.csv',
      size: 1,
    });
    expect(restored?.files).toBeUndefined();
    expect(restored?.firstImportedAt).toBeUndefined();

    await collection().updateOne(
      {},
      {
        $set: {
          files: [
            {
              _id: new Types.ObjectId(),
              storageKey: 'k',
              name: 'a.csv',
              size: 1,
            },
            {
              _id: new Types.ObjectId(),
              storageKey: 'k2',
              name: 'b.csv',
              size: 2,
            },
          ],
        },
        $unset: { vendorFile: '' },
      },
    );
    // The old shape has room for one file; dropping the second silently would
    // lose the record of what was imported.
    await expect(migration.down(connection.db)).rejects.toThrow(
      /more than one/,
    );
  });
});
