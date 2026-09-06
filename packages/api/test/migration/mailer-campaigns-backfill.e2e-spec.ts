import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { carrierSlug, mailerControlNumberKeys } from '@sfa/shared';
import { Connection, Types } from 'mongoose';
import { DEFAULT_MAILER_CARRIER } from '../../src/common/mailers/mailer-carrier';
import {
  run,
  type BackfillOptions,
  type BackfillResult,
} from '../../src/migration/backfill/mailer-campaigns';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from '../helpers/test-app';

const AGENCY_A = new Types.ObjectId();
const AGENCY_B = new Types.ObjectId();

const OPTIONS: BackfillOptions = {
  dryRun: false,
  mergeDuplicates: false,
  carrierSlug: carrierSlug(DEFAULT_MAILER_CARRIER),
};

/**
 * The PAC-71 backfill, driven against a real MongoDB (e2e).
 *
 * ⚠ **Nothing here can be proved with a fake.** The three things that matter —
 * that the index swap leaves the right index names behind, that the unique
 * constraint refuses to build over duplicates, and that a second run is a no-op
 * — are all properties of the server. `run(db, options)` is exported precisely
 * so this suite can drive it without shelling out to the CLI.
 *
 * The fixture is written through the **raw driver**, in the pre-PAC-71 shape
 * (`agencyId`, no `campaignId`), because that is the state a real database is in
 * when the script runs. Mongoose would strip the unknown field and there would
 * be nothing to migrate.
 *
 * ⚠ e2e suites share one database — never run two at once.
 */
describe('Mailer campaign backfill (e2e)', () => {
  let app: INestApplication;
  let connection: Connection;

  /** A pre-PAC-71 mailer: agency-scoped, campaign-less. */
  function legacyMailer(input: {
    agencyId: Types.ObjectId;
    long: string;
    short: string;
    weekNumber: number | null;
    quoteDate: Date | null;
    agencyid?: string;
    lastUpdatedAt?: Date;
  }) {
    return {
      agencyId: input.agencyId.toString(),
      controlNumber: input.long,
      newControlNumber: input.short,
      controlNumberKeys: mailerControlNumberKeys(input.long, input.short),
      firstName: 'Legacy',
      lastName: 'Row',
      quoteDate: input.quoteDate,
      campaign: { weekNumber: input.weekNumber },
      source: {
        system: 'bigquery',
        lastUpdatedAt: input.lastUpdatedAt,
        // The backfill reads the row's own carrier agency code back out of here.
        raw: { agencyid: input.agencyid ?? ' a0b9049 ' },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async function reset(): Promise<void> {
    const db = connection.db!;
    for (const name of ['mailers', 'mailerCampaigns', 'leads']) {
      // Created explicitly: `indexes()` on a namespace that does not exist yet
      // throws, and after `dropTestDatabase` none of these do.
      await db.createCollection(name).catch(() => undefined);
      await db.collection(name).deleteMany({});
      // Indexes as well: the swap is under test, and a leftover
      // `controlNumberKeys_1` from a previous case would make the duplicate case
      // pass for the wrong reason.
      const indexes = await db.collection(name).indexes();
      for (const index of indexes) {
        if (index.name && index.name !== '_id_') {
          await db.collection(name).dropIndex(index.name);
        }
      }
    }
    // The pre-PAC-71 index the script is meant to replace.
    await db.collection('mailers').createIndex(
      { agencyId: 1, controlNumberKeys: 1 },
      {
        unique: true,
        partialFilterExpression: { controlNumberKeys: { $type: 'string' } },
      },
    );
    await db.collection('mailers').createIndex({ agencyId: 1 });
  }

  function backfill(
    overrides: Partial<BackfillOptions> = {},
  ): Promise<BackfillResult> {
    return run(
      connection.db!,
      { ...OPTIONS, ...overrides },
      () => undefined, // silence the progress log in test output
    );
  }

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    connection = app.get<Connection>(getConnectionToken());
    // The script refuses to invent a carrier; the core seed owns that catalog.
    await connection.db!.collection('carriers').insertOne({
      agencyId: null,
      name: DEFAULT_MAILER_CARRIER,
      slug: carrierSlug(DEFAULT_MAILER_CARRIER),
      active: true,
    });
    await connection.db!.collection('agencies').insertMany([
      { _id: AGENCY_A, name: 'Agency A', slug: 'agency-a' },
      { _id: AGENCY_B, name: 'Agency B', slug: 'agency-b' },
    ]);
  });

  afterAll(async () => {
    await dropTestDatabase(app);
    await closeTestApp(app);
  });

  beforeEach(reset);

  it('refuses to run without the global carrier', async () => {
    await expect(backfill({ carrierSlug: 'no-such-carrier' })).rejects.toThrow(
      /Run the core seed first/,
    );
  });

  describe('the happy path', () => {
    beforeEach(async () => {
      await connection.db!.collection('mailers').insertMany([
        legacyMailer({
          agencyId: AGENCY_A,
          long: '#aaaa0001-0000-0000-0000-000000000001',
          short: '000000000001',
          weekNumber: 29,
          quoteDate: new Date('2026-07-13T00:00:00.000Z'),
        }),
        legacyMailer({
          agencyId: AGENCY_A,
          long: '#aaaa0002-0000-0000-0000-000000000002',
          short: '000000000002',
          weekNumber: 29,
          quoteDate: new Date('2026-07-14T00:00:00.000Z'),
        }),
        // A different week, same agency — its own campaign.
        legacyMailer({
          agencyId: AGENCY_A,
          long: '#aaaa0003-0000-0000-0000-000000000003',
          short: '000000000003',
          weekNumber: 30,
          quoteDate: new Date('2026-07-20T00:00:00.000Z'),
        }),
        // A different agency, same week — its own campaign, and the whole
        // reason the grouping key carries the agency.
        legacyMailer({
          agencyId: AGENCY_B,
          long: '#bbbb0001-0000-0000-0000-000000000011',
          short: '000000000011',
          weekNumber: 29,
          quoteDate: new Date('2026-07-13T00:00:00.000Z'),
          agencyid: 'B0C1234',
        }),
        // Neither week nor date: the "unknown" catch-all, one per agency.
        legacyMailer({
          agencyId: AGENCY_A,
          long: '#aaaa0004-0000-0000-0000-000000000004',
          short: '000000000004',
          weekNumber: null,
          quoteDate: null,
        }),
      ]);
    });

    it('creates one campaign per (agency, week, year)', async () => {
      const result = await backfill();

      // A/29, A/30, A/unknown, B/29.
      expect(result.campaignsCreated).toBe(4);
      expect(result.mailersStamped).toBe(5);

      const campaigns = await connection
        .db!.collection('mailerCampaigns')
        .find({})
        .toArray();
      expect(campaigns.map((c) => c.migrationKey as string).sort()).toEqual(
        [
          `${AGENCY_A.toString()}|29|2026`,
          `${AGENCY_A.toString()}|30|2026`,
          `${AGENCY_A.toString()}|unknown|unknown`,
          `${AGENCY_B.toString()}|29|2026`,
        ].sort(),
      );
      // An implicit campaign describes a run that already happened, and records
      // that nothing is known about how it was priced.
      expect(campaigns.every((c) => c.status === 'imported')).toBe(true);
      expect(campaigns.every((c) => c.settings === null)).toBe(true);
      expect(campaigns.every((c) => c.source === 'migration')).toBe(true);
    });

    it('stamps campaign, visibility and the carrier agency code', async () => {
      await backfill();

      const mailer = await connection.db!.collection('mailers').findOne({
        controlNumberKeys: mailerControlNumberKeys(
          '#aaaa0001-0000-0000-0000-000000000001',
          '000000000001',
        )[0],
      });
      const campaign = await connection
        .db!.collection('mailerCampaigns')
        .findOne({ migrationKey: `${AGENCY_A.toString()}|29|2026` });

      expect(mailer!.campaignId).toBe(campaign!._id.toString());
      // The rows' agency *was* their whole tenancy, so it carries across as an
      // explicit list — never widened to "all".
      expect(mailer!.visibleAgencyIds).toEqual([AGENCY_A.toString()]);
      // Trimmed and uppercased out of `source.raw`, matching `appointmentCodeKey`.
      expect(mailer!.carrierAgencyId).toBe('A0B9049');
    });

    it('never puts one agency mailers under another agency campaign', async () => {
      await backfill();

      const b = await connection
        .db!.collection('mailers')
        .findOne({ controlNumberKeys: '000000000011' });
      const bCampaign = await connection
        .db!.collection('mailerCampaigns')
        .findOne({ migrationKey: `${AGENCY_B.toString()}|29|2026` });

      expect(b!.campaignId).toBe(bCampaign!._id.toString());
      expect(b!.visibleAgencyIds).toEqual([AGENCY_B.toString()]);
    });

    it('swaps the dedupe index and drops the agency ones', async () => {
      const result = await backfill();

      const names = (await connection.db!.collection('mailers').indexes()).map(
        (i) => i.name,
      );
      expect(names).toContain('controlNumberKeys_1');
      expect(names).not.toContain('agencyId_1_controlNumberKeys_1');
      expect(names).not.toContain('agencyId_1');
      expect(result.indexesDropped).toEqual(
        expect.arrayContaining([
          'agencyId_1_controlNumberKeys_1',
          'agencyId_1',
        ]),
      );

      // Unique, and partial rather than sparse — the house rule.
      const dedupe = (
        await connection.db!.collection('mailers').indexes()
      ).find((i) => i.name === 'controlNumberKeys_1');
      expect(dedupe!.unique).toBe(true);
      expect(dedupe!.partialFilterExpression).toEqual({
        controlNumberKeys: { $type: 'string' },
      });
      expect(dedupe!.sparse).toBeUndefined();
    });

    it('drops agencyId from every mailer', async () => {
      const result = await backfill();

      expect(result.agencyIdUnset).toBe(5);
      expect(
        await connection
          .db!.collection('mailers')
          .countDocuments({ agencyId: { $exists: true } }),
      ).toBe(0);
    });

    it('is a no-op on a second run', async () => {
      await backfill();
      const second = await backfill();

      expect(second.campaignsCreated).toBe(0);
      expect(second.mailersStamped).toBe(0);
      expect(second.agencyIdUnset).toBe(0);
      expect(second.blockers).toEqual([]);
      // And nothing was duplicated.
      expect(
        await connection.db!.collection('mailerCampaigns').countDocuments({}),
      ).toBe(4);
    });

    it('writes nothing on a dry run', async () => {
      const result = await backfill({ dryRun: true });

      expect(result.campaignsCreated).toBe(4);
      expect(
        await connection.db!.collection('mailerCampaigns').countDocuments({}),
      ).toBe(0);
      expect(
        await connection
          .db!.collection('mailers')
          .countDocuments({ campaignId: { $exists: true } }),
      ).toBe(0);
    });
  });

  describe('duplicate control-number keys', () => {
    /** The same mailer held by two agencies — legal before, not after. */
    async function seedDuplicates(): Promise<void> {
      await connection.db!.collection('mailers').insertMany([
        legacyMailer({
          agencyId: AGENCY_A,
          long: '#dddd0001-0000-0000-0000-0000000000dd',
          short: '0000000000dd',
          weekNumber: 29,
          quoteDate: new Date('2026-07-13T00:00:00.000Z'),
          lastUpdatedAt: new Date('2026-07-01T00:00:00.000Z'),
        }),
        legacyMailer({
          agencyId: AGENCY_B,
          long: '#dddd0001-0000-0000-0000-0000000000dd',
          short: '0000000000dd',
          weekNumber: 29,
          quoteDate: new Date('2026-07-13T00:00:00.000Z'),
          lastUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
        }),
      ]);
    }

    it('stops before touching any index, listing what it found', async () => {
      // Rebuilding a unique index over real duplicates fails, and failing after
      // the drop would leave the collection with no uniqueness at all.
      await seedDuplicates();
      const result = await backfill();

      expect(result.duplicateKeys).toBe(2);
      expect(result.blockers[0]).toMatch(/--merge-duplicates/);
      expect(result.indexesDropped).toEqual([]);

      const names = (await connection.db!.collection('mailers').indexes()).map(
        (i) => i.name,
      );
      expect(names).toContain('agencyId_1_controlNumberKeys_1');
      expect(names).not.toContain('controlNumberKeys_1');
    });

    it('keeps the newest row, unions visibility and repoints lead links', async () => {
      await seedDuplicates();
      await backfill();

      const stale = await connection
        .db!.collection('mailers')
        .findOne({ agencyId: AGENCY_A.toString() });
      const leadId = new Types.ObjectId();
      await connection.db!.collection('leads').insertOne({
        _id: leadId,
        agencyId: AGENCY_A.toString(),
        mailer: { mailerId: stale!._id, campaignId: null },
      });

      const result = await backfill({ mergeDuplicates: true });

      expect(result.duplicatesMerged).toBe(1);
      const survivors = await connection
        .db!.collection('mailers')
        .find({})
        .toArray();
      expect(survivors).toHaveLength(1);
      // Agency B's row is newer (`source.lastUpdatedAt`), so it survives — but
      // the visibility is the UNION: agency A's producers can still look the
      // mailer up, which they could before the merge.
      expect((survivors[0].visibleAgencyIds as string[]).sort()).toEqual(
        [AGENCY_A.toString(), AGENCY_B.toString()].sort(),
      );

      // The lead follows the survivor rather than dangling.
      const lead = await connection
        .db!.collection('leads')
        .findOne({ _id: leadId });
      expect((lead!.mailer as { mailerId: Types.ObjectId }).mailerId).toEqual(
        survivors[0]._id,
      );

      // And the index it was blocking now exists.
      const names = (await connection.db!.collection('mailers').indexes()).map(
        (i) => i.name,
      );
      expect(names).toContain('controlNumberKeys_1');
    });
  });

  describe('lead backfill', () => {
    const LONG = '#eeee0001-0000-0000-0000-0000000000ee';
    const SHORT = '0000000000ee';
    const KEY = mailerControlNumberKeys(LONG, SHORT)[0];

    beforeEach(async () => {
      await connection.db!.collection('mailers').insertOne(
        legacyMailer({
          agencyId: AGENCY_A,
          long: LONG,
          short: SHORT,
          weekNumber: 29,
          quoteDate: new Date('2026-07-13T00:00:00.000Z'),
        }),
      );
    });

    it('links a lead carrying the control number, as control_number', async () => {
      await connection.db!.collection('leads').insertOne({
        agencyId: AGENCY_A.toString(),
        // Stored as printed — never normalized, which is exactly why the old
        // string join missed.
        quoteControlNumber: LONG,
      });

      const result = await backfill();
      expect(result.leadsLinked).toBe(1);

      const lead = await connection.db!.collection('leads').findOne({});
      const mailer = await connection.db!.collection('mailers').findOne({});
      const link = lead!.mailer as Record<string, unknown>;

      expect(link.mailerId).toEqual(mailer!._id);
      expect(link.campaignId).toBe(mailer!.campaignId);
      expect(link.controlNumberKey).toBe(KEY);
      expect(link.matchedBy).toBe('control_number');
      // Nobody made this link; a script did.
      expect(link.linkedBy).toBeNull();
    });

    it('matches the short printed form too', async () => {
      await connection.db!.collection('leads').insertOne({
        agencyId: AGENCY_A.toString(),
        quoteControlNumber: SHORT,
      });

      const result = await backfill();
      expect(result.leadsLinked).toBe(1);
    });

    it('stores the key alone when no mailer matches', async () => {
      await connection.db!.collection('leads').insertOne({
        agencyId: AGENCY_A.toString(),
        quoteControlNumber: '#ffff0000-1111-2222-3333-444444444444',
      });

      const result = await backfill();

      expect(result.leadsLinked).toBe(0);
      expect(result.leadsKeyOnly).toBe(1);
      const lead = await connection.db!.collection('leads').findOne({});
      expect((lead!.mailer as { mailerId: unknown }).mailerId).toBeNull();
    });

    it('will not link a mailer the lead agency cannot see', async () => {
      // The same visibility query the drawer runs. A mailer this agency cannot
      // look up is not this lead's mailer, however well the number matches.
      await connection.db!.collection('leads').insertOne({
        agencyId: AGENCY_B.toString(),
        quoteControlNumber: LONG,
      });

      const result = await backfill();
      expect(result.leadsLinked).toBe(0);
      expect(result.leadsKeyOnly).toBe(1);
    });

    it('links neither when two leads claim the same mailer', async () => {
      // ⚠ The two leads here carry the SAME mailer under two DIFFERENT keys —
      // the long and short printed forms normalize differently, and the mailer
      // holds both. Grouping by key alone would call each one unique and try to
      // link both, which the unique index rejects with E11000 and which fails
      // the entire run. Neither is linked; both are reported.
      await connection.db!.collection('leads').insertMany([
        { agencyId: AGENCY_A.toString(), quoteControlNumber: LONG },
        { agencyId: AGENCY_A.toString(), quoteControlNumber: SHORT },
      ]);

      const result = await backfill();

      expect(result.leadsLinked).toBe(0);
      expect(result.leadsConflicted).toBe(2);
      expect(result.blockers).toEqual([]);

      const leads = await connection.db!.collection('leads').find({}).toArray();
      for (const lead of leads) {
        const link = lead.mailer as Record<string, unknown>;
        expect(link.mailerId).toBeNull();
        // Each keeps the key it actually carried, not a normalized-together one.
        expect(typeof link.controlNumberKey).toBe('string');
      }
    });

    it('reports two leads sharing one key rather than picking one', async () => {
      await connection.db!.collection('leads').insertMany([
        { agencyId: AGENCY_A.toString(), quoteControlNumber: LONG },
        {
          agencyId: AGENCY_A.toString(),
          quoteControlNumber: LONG.toUpperCase(),
        },
      ]);

      const result = await backfill();

      expect(result.leadsLinked).toBe(0);
      expect(result.leadsConflicted).toBe(2);
      const leads = await connection.db!.collection('leads').find({}).toArray();
      for (const lead of leads) {
        expect((lead.mailer as { mailerId: unknown }).mailerId).toBeNull();
        expect(
          (lead.mailer as { controlNumberKey: string }).controlNumberKey,
        ).toBe(KEY);
      }
    });

    it('leaves a mailer another lead already owns alone', async () => {
      // Idempotency across partial runs: a lead linked by an earlier pass (or by
      // the drawer, mid-migration) keeps the mailer, and the newcomer gets the
      // key alone rather than an E11000.
      await backfill();
      const mailer = await connection.db!.collection('mailers').findOne({});
      await connection.db!.collection('leads').insertOne({
        agencyId: AGENCY_A.toString(),
        mailer: {
          mailerId: mailer!._id,
          campaignId: mailer!.campaignId as string,
          controlNumberKey: KEY,
          matchedBy: 'drawer',
          linkedBy: null,
        },
      });
      await connection.db!.collection('leads').insertOne({
        agencyId: AGENCY_A.toString(),
        quoteControlNumber: LONG,
      });

      const result = await backfill();

      expect(result.leadsLinked).toBe(0);
      expect(result.leadsKeyOnly).toBe(1);
      expect(
        await connection
          .db!.collection('leads')
          .countDocuments({ 'mailer.mailerId': mailer!._id }),
      ).toBe(1);
    });

    it('builds the three lead indexes, the unique one partial', async () => {
      await backfill();

      const indexes = await connection.db!.collection('leads').indexes();
      const unique = indexes.find((i) => i.name === 'mailer.mailerId_1');
      expect(unique!.unique).toBe(true);
      // ⚠ `objectId`, not `exists` — the unmatched state stores an explicit
      // `null` that every such lead would otherwise collide on.
      expect(unique!.partialFilterExpression).toEqual({
        'mailer.mailerId': { $type: 'objectId' },
      });
      expect(indexes.map((i) => i.name)).toEqual(
        expect.arrayContaining([
          'mailer.campaignId_1_agencyId_1',
          'mailer.controlNumberKey_1',
        ]),
      );
    });

    it('leaves an already-linked lead alone on a second run', async () => {
      await connection.db!.collection('leads').insertOne({
        agencyId: AGENCY_A.toString(),
        quoteControlNumber: LONG,
      });

      await backfill();
      const first = await connection.db!.collection('leads').findOne({});
      const second = await backfill();

      expect(second.leadsLinked).toBe(0);
      expect(second.leadsKeyOnly).toBe(0);
      const after = await connection.db!.collection('leads').findOne({});
      expect(after!.mailer).toEqual(first!.mailer);
    });
  });
});
