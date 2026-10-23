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
  require('../../migrations/20261019120000-audit_review_flags_and_producer_counters.js') as {
    up(db: unknown): Promise<void>;
    down(db: unknown): Promise<void>;
  };
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * PAC-106's flags-and-counters migration, driven against a real MongoDB.
 *
 * Every document is written through the **raw driver** in the pre-PAC-106
 * shape — no `producerVisible`, no `reviewVerdict`, no producer counters —
 * because that is what a database holds when the API boots with this file
 * pending.
 *
 * ⚠ e2e suites share one database — never run two at once.
 */
describe('audit_review_flags_and_producer_counters migration (e2e)', () => {
  let app: INestApplication;
  let connection: Connection;

  const db = () => connection.db!;
  const agencyId = new Types.ObjectId().toString();

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
    for (const name of [
      'auditTemplates',
      'dealAuditItems',
      'dealAudits',
      'deals',
    ]) {
      await db().collection(name).deleteMany({});
    }
  });

  /** One audit + its deal + its items, in the old shape. */
  const seedAudit = async (
    auditStatus: string,
    items: Array<Record<string, unknown>>,
  ) => {
    const dealId = new Types.ObjectId();
    const auditId = new Types.ObjectId();
    await db()
      .collection('deals')
      .insertOne({ _id: dealId, agencyId, dealAuditStatus: auditStatus });
    await db().collection('dealAudits').insertOne({
      _id: auditId,
      agencyId,
      dealId,
      auditStatus,
      itemCount: items.length,
    });
    if (items.length) {
      await db()
        .collection('dealAuditItems')
        .insertMany(
          items.map((item) => ({
            agencyId,
            dealId,
            dealAuditId: auditId,
            isFailed: true,
            isResolved: false,
            ...item,
          })),
        );
    }
    return { dealId, auditId };
  };

  const audit = (id: Types.ObjectId) =>
    db().collection('dealAudits').findOne({ _id: id });

  it('flags templates by name, leaving an agency’s own template visible', async () => {
    await db()
      .collection('auditTemplates')
      .insertMany([
        { agencyId, name: 'Correct Sold Date' },
        { agencyId, name: 'Good Student' },
        { agencyId, name: 'Home Inspection' },
        { agencyId, name: 'Our Own Checklist Item' },
      ]);

    await migration.up(db());

    const byName = new Map(
      (await db().collection('auditTemplates').find().toArray()).map((t) => [
        t.name as string,
        [t.producerVisible, t.requiresUpload],
      ]),
    );
    expect(byName.get('Correct Sold Date')).toEqual([false, false]);
    expect(byName.get('Good Student')).toEqual([true, true]);
    expect(byName.get('Home Inspection')).toEqual([true, false]);
    expect(byName.get('Our Own Checklist Item')).toEqual([true, false]);
  });

  it('flags items by template, else by legacy name, and initialises the verdict', async () => {
    const managerOnly = new Types.ObjectId();
    await db()
      .collection('auditTemplates')
      .insertOne({ _id: managerOnly, agencyId, name: 'Quote Recap' });

    const { auditId } = await seedAudit('Fail', [
      { templateId: managerOnly, itemName: 'Quote Recap' },
      // Migrated: no template, and legacy's unprefixed name.
      { itemName: 'Fire Subscription' },
      // A fanned-out item carries its subject.
      { itemName: 'Defensive Driver — Sam Lopez' },
    ]);

    await migration.up(db());

    const items = await db()
      .collection('dealAuditItems')
      .find({ dealAuditId: auditId })
      .toArray();
    const flags = new Map(
      items.map((item) => [
        item.itemName as string,
        [item.producerVisible, item.requiresUpload, item.reviewVerdict],
      ]),
    );
    expect(flags.get('Quote Recap')).toEqual([false, false, null]);
    expect(flags.get('Fire Subscription')).toEqual([true, true, null]);
    expect(flags.get('Defensive Driver — Sam Lopez')).toEqual([
      true,
      true,
      null,
    ]);

    // Two producer items, both open; the manager-only one is not counted.
    const stored = await audit(auditId);
    expect(stored).toMatchObject({
      producerItemCount: 2,
      producerResolvedCount: 0,
      producerOpenCount: 2,
    });
  });

  it('submits a Not Submitted audit with nothing for the producer, and only that one', async () => {
    const stranded = await seedAudit('Not Submitted', [
      { itemName: 'Correct Sold Date' },
      { itemName: 'Drivers Verified' },
    ]);
    const working = await seedAudit('Not Submitted', [
      { itemName: 'Correct Sold Date' },
      { itemName: 'Good Student' },
    ]);
    const empty = await seedAudit('Not Submitted', []);
    const failed = await seedAudit('Fail', [{ itemName: 'Quote Recap' }]);

    await migration.up(db());

    const flipped = await audit(stranded.auditId);
    expect(flipped).toMatchObject({
      auditStatus: 'Pending',
      submittedById: null,
      producerItemCount: 0,
    });
    expect(flipped!.submittedAt).toBeInstanceOf(Date);
    // The deal's display copy follows.
    expect(
      (await db().collection('deals').findOne({ _id: stranded.dealId }))!
        .dealAuditStatus,
    ).toBe('Pending');

    // An audit with no items has nothing to wait on either.
    expect((await audit(empty.auditId))!.auditStatus).toBe('Pending');

    // The producer still has Good Student to provide.
    expect((await audit(working.auditId))!.auditStatus).toBe('Not Submitted');
    // Only `Not Submitted` moves; a sent-back audit is the producer's.
    expect((await audit(failed.auditId))!.auditStatus).toBe('Fail');
  });

  it('is idempotent: a second run changes nothing', async () => {
    const { auditId } = await seedAudit('Not Submitted', [
      { itemName: 'Good Student', isResolved: true },
      { itemName: 'Prior Insurance' },
    ]);

    await migration.up(db());
    const first = await audit(auditId);
    await migration.up(db());
    const second = await audit(auditId);

    expect(second).toEqual(first);
    expect(second).toMatchObject({
      auditStatus: 'Not Submitted',
      producerItemCount: 2,
      producerResolvedCount: 1,
      producerOpenCount: 1,
    });
  });

  it('down removes the fields but leaves an auto-submitted audit with its reviewer', async () => {
    const { auditId } = await seedAudit('Not Submitted', [
      { itemName: 'Correct Sold Date' },
    ]);

    await migration.up(db());
    await migration.down(db());

    const stored = await audit(auditId);
    expect(stored).not.toHaveProperty('producerItemCount');
    expect(stored!.auditStatus).toBe('Pending');
    const item = await db()
      .collection('dealAuditItems')
      .findOne({ dealAuditId: auditId });
    expect(item).not.toHaveProperty('producerVisible');
    expect(item).not.toHaveProperty('reviewVerdict');
  });
});
