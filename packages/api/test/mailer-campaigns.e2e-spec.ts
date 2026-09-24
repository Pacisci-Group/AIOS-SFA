import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import type {
  MailerCampaign as MailerCampaignDto,
  MailerCampaignDefaults,
  MailerCampaignListResponse,
  MailerCampaignRecordsResponse,
  MailerCampaignSettings,
} from '@sfa/shared';
import { Carrier } from '../src/carriers/schemas/carrier.schema';
import { StorageService } from '../src/storage/storage.service';
import { MailerCampaign } from '../src/mailers/schemas/mailer-campaign.schema';
import { Mailer } from '../src/mailers/schemas/mailer.schema';
import { authHeader, login } from './helpers/auth.helper';
import { FakeStorage } from './helpers/fake-storage';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';
import {
  seedTestData,
  TEST_PASSWORD,
  TestSeedContext,
} from './helpers/seed-test-data';

/**
 * The mailer campaign API (PAC-71).
 *
 * The commit **gate** is what this suite is really about. Every branch of it
 * exists because the alternative is a wrong write nobody asked for — a run
 * started from a preview that no longer describes the file, an overwrite that
 * deletes a different number of mailers than the operator agreed to, or two
 * operators both starting the same import. Those are asserted here rather than
 * in a unit spec because the gate reads live counts out of Mongo and runs
 * behind the real guard chain; a fake model would test the shape of the code
 * instead of the rule.
 *
 * Object storage is a `FakeStorage`: these tests are about the gate, not about
 * S3, and requiring MinIO would make the suite fail on any machine that has not
 * started it.
 */
describe('Mailer campaigns (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let storage: FakeStorage;
  let superAdminToken: string;
  let ownerToken: string;
  let carriers: Model<Carrier>;
  let campaigns: Model<MailerCampaign>;
  let mailers: Model<Mailer>;
  let allstateId: Types.ObjectId;

  const api = () => request(app.getHttpServer());
  const base = '/api/v1/platform/mailer-campaigns';

  /** A settings block that satisfies the DTO's "no defaults" rule. */
  const settings = (
    overrides: Partial<MailerCampaignSettings> = {},
  ): MailerCampaignSettings => ({
    premiumFloor: 1886.15,
    fileName: 'SFA-QBP',
    defaultMarket: 'Oklahoma City',
    marketPhones: { Tulsa: '918-984-6163' },
    defaultPhone: '405-803-7590',
    runYear: 2026,
    discounts: {
      squareFootage: [{ minSquareFeet: 2000, rate: 0.36 }],
      homeAge: { maxNewYears: 9, newRate: 0.04, oldRate: 0.1 },
    },
    zipResolutions: {},
    outputRecipients: [],
    ...overrides,
  });

  /**
   * Upload a file and record the campaign, the way the browser does: presign,
   * PUT the bytes straight to storage, then `POST` the key back.
   */
  const uploadCampaign = async (
    body: Record<string, unknown> = {},
    bytes = 'controlno,firstname\n#a,Ada\n',
  ): Promise<MailerCampaignDto> => {
    const presign = await api()
      .post(`${base}/presign`)
      .set(authHeader(superAdminToken))
      .send({ filename: 'SFA-QBP.csv', size: bytes.length })
      .expect(201);

    const key = (presign.body as { key: string }).key;
    await storage.putObject(key, Buffer.from(bytes, 'utf8'), 'text/csv');

    const created = await api()
      .post(base)
      .set(authHeader(superAdminToken))
      .send({
        source: 'vendor',
        storageKey: key,
        uploadedFilename: 'SFA-QBP.csv',
        size: bytes.length,
        campaignNumber: '36',
        assignment: { mode: 'carrier_agency_id' },
        settings: settings(),
        ...body,
      })
      .expect(201);

    return created.body as MailerCampaignDto;
  };

  /** Drop a campaign straight into a state the API cannot reach on its own. */
  const forceState = (id: string, patch: Record<string, unknown>) =>
    campaigns.updateOne({ _id: id }, { $set: patch });

  /** The shape a preview leaves behind when everything resolved cleanly. */
  const cleanPreview = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    missingRequiredColumns: [],
    missingRecommendedColumns: [],
    stats: null,
    unmatchedZips: [],
    floorHitRate: 0,
    assignment: {
      resolved: [
        { codeKey: 'A0B9049', agencyId: null, agencyName: null, rows: 2 },
      ],
      unmatched: [],
    },
    existingCampaigns: [],
    overlap: {
      existingInOtherCampaigns: 0,
      replacedRecordCount: 0,
      deleteCountIfOverwrite: 0,
    },
    rejections: [],
    inconsistentColumns: [],
    ...overrides,
  });

  beforeAll(async () => {
    storage = new FakeStorage();
    app = await createTestApp({
      overrides: [{ provide: StorageService, useValue: storage.asService() }],
    });
    await dropTestDatabase(app);
    ctx = await seedTestData(app);

    carriers = app.get<Model<Carrier>>(getModelToken(Carrier.name));
    campaigns = app.get<Model<MailerCampaign>>(
      getModelToken(MailerCampaign.name),
    );
    mailers = app.get<Model<Mailer>>(getModelToken(Mailer.name));

    const allstate = await carriers.create({
      agencyId: null,
      name: 'Allstate',
      slug: 'allstate',
      active: true,
      displayOrder: 0,
    });
    allstateId = allstate._id;

    superAdminToken = (await login(app, ctx.superAdminEmail, TEST_PASSWORD))
      .accessToken;
    ownerToken = (await login(app, ctx.ownerEmail, TEST_PASSWORD)).accessToken;
  });

  afterAll(async () => {
    if (app) {
      await dropTestDatabase(app);
      await closeTestApp(app);
    }
  });

  beforeEach(async () => {
    await campaigns.deleteMany({});
    await mailers.deleteMany({});
  });

  // -------------------------------------------------------------------------

  describe('access', () => {
    it('refuses an agency owner without platform:mailers:read', async () => {
      await api().get(base).set(authHeader(ownerToken)).expect(403);
      await api()
        .post(`${base}/presign`)
        .set(authHeader(ownerToken))
        .send({ filename: 'x.csv', size: 10 })
        .expect(403);
    });

    it('refuses an anonymous caller', async () => {
      await api().get(base).expect(401);
    });
  });

  describe('defaults', () => {
    it('prefills the Allstate carrier, this week and Apex settings', async () => {
      const res = await api()
        .get(`${base}/defaults`)
        .set(authHeader(superAdminToken))
        .expect(200);
      const body = res.body as MailerCampaignDefaults;

      expect(body.carrierId).toBe(allstateId.toString());
      expect(body.carrierName).toBe('Allstate');
      expect(body.campaignNumber).toMatch(/^Week_Number-\d+$/);
      expect(body.settings.premiumFloor).toBeGreaterThan(0);
      expect(body.settings.runYear).toBe(new Date().getFullYear());
      // `carrier_agency_id` is the default: the file says whose the rows are.
      expect(body.assignment.mode).toBe('carrier_agency_id');
    });

    it('inherits the last imported campaign settings but never its run year', async () => {
      await campaigns.create({
        carrierId: allstateId,
        name: 'Last week',
        status: 'imported',
        source: 'vendor',
        assignment: { mode: 'agencies', agencyIds: [ctx.agencyId] },
        settings: settings({
          premiumFloor: 1234.56,
          runYear: 2019,
          // ⚠ Resolved for *that* file. Carrying them forward would hide new
          // unmapped ZIPs in the next preview.
          zipResolutions: { '74133': 'Tulsa' },
        }),
      });

      const res = await api()
        .get(`${base}/defaults`)
        .set(authHeader(superAdminToken))
        .expect(200);
      const body = res.body as MailerCampaignDefaults;

      expect(body.settings.premiumFloor).toBe(1234.56);
      expect(body.settings.runYear).toBe(new Date().getFullYear());
      expect(body.settings.zipResolutions).toEqual({});
      expect(body.assignment).toEqual({
        mode: 'agencies',
        agencyIds: [ctx.agencyId],
      });
    });
  });

  describe('upload and create', () => {
    it('signs a platform key and records the campaign as uploaded', async () => {
      const campaign = await uploadCampaign();

      expect(campaign.status).toBe('uploaded');
      expect(campaign.carrierName).toBe('Allstate');
      expect(campaign.campaignNumber).toBe('Week_Number-36');
      expect(campaign.weekNumber).toBe(36);
      expect(campaign.vendorFile?.name).toBe('SFA-QBP.csv');
      expect(storage.presigned[0]).toMatch(/^platform\/mailer-campaigns\//);
      // ⚠ The storage key is a capability and must never reach a client.
      expect(campaign.vendorFile).not.toHaveProperty('storageKey');
    });

    it('refuses a key from outside the campaign namespace', async () => {
      const key = storage.buildObjectKey({
        agencyId: ctx.agencyId,
        purpose: 'deal-audits',
        filename: 'private.pdf',
      });
      await storage.putObject(key, Buffer.from('x'), 'text/csv');

      await api()
        .post(base)
        .set(authHeader(superAdminToken))
        .send({
          source: 'vendor',
          storageKey: key,
          uploadedFilename: 'private.pdf',
          size: 1,
          assignment: { mode: 'all' },
          settings: settings(),
        })
        .expect(400);
    });

    it('refuses a declared size the stored object does not have', async () => {
      const presign = await api()
        .post(`${base}/presign`)
        .set(authHeader(superAdminToken))
        .send({ filename: 'SFA-QBP.csv', size: 999 })
        .expect(201);
      const key = (presign.body as { key: string }).key;
      await storage.putObject(key, Buffer.from('tiny'), 'text/csv');

      // `HeadObject` is the only server-side evidence of what was really
      // stored; a presigned PUT signs only the content type.
      await api()
        .post(base)
        .set(authHeader(superAdminToken))
        .send({
          source: 'vendor',
          storageKey: key,
          uploadedFilename: 'SFA-QBP.csv',
          size: 999,
          assignment: { mode: 'all' },
          settings: settings(),
        })
        .expect(400);
    });

    it('refuses an `agencies` assignment naming nobody, or a stranger', async () => {
      await api()
        .post(base)
        .set(authHeader(superAdminToken))
        .send({
          source: 'vendor',
          storageKey: 'platform/mailer-campaigns/2026/vendor/x.csv',
          uploadedFilename: 'x.csv',
          size: 1,
          assignment: { mode: 'agencies', agencyIds: [] },
          settings: settings(),
        })
        .expect(400);

      const presign = await api()
        .post(`${base}/presign`)
        .set(authHeader(superAdminToken))
        .send({ filename: 'x.csv', size: 4 })
        .expect(201);
      const key = (presign.body as { key: string }).key;
      await storage.putObject(key, Buffer.from('abcd'), 'text/csv');

      await api()
        .post(base)
        .set(authHeader(superAdminToken))
        .send({
          source: 'vendor',
          storageKey: key,
          uploadedFilename: 'x.csv',
          size: 4,
          assignment: {
            mode: 'agencies',
            agencyIds: ['507f1f77bcf86cd799439011'],
          },
          settings: settings(),
        })
        .expect(400);
    });
  });

  describe('patch', () => {
    it('writes ZIP resolutions into the platform table and re-previews', async () => {
      const campaign = await uploadCampaign();
      await forceState(campaign.id, { status: 'previewed' });

      const res = await api()
        .patch(`${base}/${campaign.id}`)
        .set(authHeader(superAdminToken))
        .send({ settings: settings({ zipResolutions: { '74133': 'Tulsa' } }) })
        .expect(200);
      const body = res.body as MailerCampaignDto;

      // Back to `uploaded` with a bumped attempt: the stored preview described
      // the *old* settings, and a commit must not gate against those.
      expect(body.status).toBe('uploaded');
      expect(body.preview).toBeNull();

      const zips = await api()
        .get('/api/v1/platform/mailer-zip-markets')
        .query({ q: '74133' })
        .set(authHeader(superAdminToken))
        .expect(200);
      expect(
        (zips.body as { items: { zip5: string; market: string }[] }).items,
      ).toEqual([expect.objectContaining({ zip5: '74133', market: 'Tulsa' })]);
    });

    it('refuses to change a campaign that is already processing', async () => {
      const campaign = await uploadCampaign();
      await forceState(campaign.id, { status: 'processing' });

      await api()
        .patch(`${base}/${campaign.id}`)
        .set(authHeader(superAdminToken))
        .send({ name: 'Renamed' })
        .expect(409);
    });
  });

  describe('commit gate', () => {
    it('refuses to commit anything that has not been previewed', async () => {
      const campaign = await uploadCampaign();

      const res = await api()
        .post(`${base}/${campaign.id}/commit`)
        .set(authHeader(superAdminToken))
        .send({ mode: 'append' })
        .expect(409);
      expect((res.body as { message: string }).message).toContain('uploaded');
    });

    it('refuses while any carrier agency code matches no agency', async () => {
      const campaign = await uploadCampaign();
      await forceState(campaign.id, {
        status: 'previewed',
        preview: cleanPreview({
          assignment: {
            resolved: [
              {
                codeKey: 'A0B9049',
                agencyId: null,
                agencyName: null,
                rows: 20,
              },
            ],
            unmatched: ['A0B9049'],
          },
        }),
      });

      const res = await api()
        .post(`${base}/${campaign.id}/commit`)
        .set(authHeader(superAdminToken))
        .send({ mode: 'append' })
        .expect(422);

      // The message names both fixes, not just the fault.
      const errors = (res.body as { errors: string[] }).errors;
      expect(errors[0]).toContain('A0B9049');
      expect(errors[0]).toContain('Add the appointment');
    });

    it('re-resolves the assignment at commit time, not from the preview', async () => {
      const campaign = await uploadCampaign();
      // The preview says every code resolved — but nobody actually holds it,
      // which is the case where an appointment was revoked in between.
      await forceState(campaign.id, {
        status: 'previewed',
        preview: cleanPreview(),
      });

      await api()
        .post(`${base}/${campaign.id}/commit`)
        .set(authHeader(superAdminToken))
        .send({ mode: 'append' })
        .expect(422);
    });

    it('commits an `all` campaign and moves it to processing', async () => {
      const campaign = await uploadCampaign({ assignment: { mode: 'all' } });
      await forceState(campaign.id, {
        status: 'previewed',
        preview: cleanPreview(),
      });

      const res = await api()
        .post(`${base}/${campaign.id}/commit`)
        .set(authHeader(superAdminToken))
        .send({ mode: 'append' })
        .expect(202);

      const body = res.body as MailerCampaignDto;
      expect(body.status).toBe('processing');
      expect(body.commitMode).toBe('append');
      expect(body.requestedBy).toBeTruthy();
    });

    it('loses the compare-and-set when someone else started the run first', async () => {
      const campaign = await uploadCampaign({ assignment: { mode: 'all' } });
      await forceState(campaign.id, {
        status: 'previewed',
        preview: cleanPreview(),
      });
      await api()
        .post(`${base}/${campaign.id}/commit`)
        .set(authHeader(superAdminToken))
        .send({ mode: 'append' })
        .expect(202);

      // The second operator was looking at the same previewed page.
      await api()
        .post(`${base}/${campaign.id}/commit`)
        .set(authHeader(superAdminToken))
        .send({ mode: 'append' })
        .expect(409);
    });

    describe('overwrite', () => {
      let replaced: string;

      beforeEach(async () => {
        const old = await campaigns.create({
          carrierId: allstateId,
          name: 'Week 36, first run',
          campaignNumber: 'Week_Number-36',
          year: 2026,
          status: 'imported',
          source: 'vendor',
          assignment: { mode: 'all', agencyIds: [] },
        });
        replaced = old._id.toString();

        await mailers.create([
          {
            campaignId: replaced,
            visibleAgencyIds: null,
            controlNumberKeys: ['AAAA1111'],
            source: { system: 'spreadsheet' },
          },
          {
            campaignId: replaced,
            visibleAgencyIds: null,
            controlNumberKeys: ['BBBB2222'],
            source: { system: 'spreadsheet' },
          },
        ]);
      });

      const previewWithOverlap = (deleteCount: number) =>
        cleanPreview({
          existingCampaigns: [
            {
              campaignId: replaced,
              name: 'Week 36, first run',
              campaignNumber: 'Week_Number-36',
              year: 2026,
              status: 'imported',
              recordCount: 2,
            },
          ],
          overlap: {
            existingInOtherCampaigns: 1,
            replacedRecordCount: 2,
            deleteCountIfOverwrite: deleteCount,
          },
        });

      it('refuses to replace a campaign the preview never offered', async () => {
        const campaign = await uploadCampaign({ assignment: { mode: 'all' } });
        await forceState(campaign.id, {
          status: 'previewed',
          preview: previewWithOverlap(1),
        });

        await api()
          .post(`${base}/${campaign.id}/commit`)
          .set(authHeader(superAdminToken))
          .send({
            mode: 'overwrite',
            replaceCampaignIds: ['507f1f77bcf86cd799439011'],
            expectedDeleteCount: 1,
          })
          .expect(400);
      });

      it('refuses when the replaced campaign no longer holds what was counted', async () => {
        const campaign = await uploadCampaign({ assignment: { mode: 'all' } });
        await forceState(campaign.id, {
          status: 'previewed',
          preview: previewWithOverlap(1),
        });
        // Somebody committed another campaign in between.
        await mailers.deleteOne({ controlNumberKeys: 'BBBB2222' });

        const res = await api()
          .post(`${base}/${campaign.id}/commit`)
          .set(authHeader(superAdminToken))
          .send({
            mode: 'overwrite',
            replaceCampaignIds: [replaced],
            expectedDeleteCount: 1,
          })
          .expect(409);
        expect((res.body as { message: string }).message).toContain(
          'Re-run the preview',
        );
      });

      it('refuses a delete count the operator did not confirm', async () => {
        const campaign = await uploadCampaign({ assignment: { mode: 'all' } });
        await forceState(campaign.id, {
          status: 'previewed',
          preview: previewWithOverlap(1),
        });

        const res = await api()
          .post(`${base}/${campaign.id}/commit`)
          .set(authHeader(superAdminToken))
          .send({
            mode: 'overwrite',
            replaceCampaignIds: [replaced],
            // The dialog said 1.
            expectedDeleteCount: 0,
          })
          .expect(409);
        expect((res.body as { message: string }).message).toContain(
          'would delete 1',
        );
      });

      it('accepts the numbers the operator was actually shown', async () => {
        const campaign = await uploadCampaign({ assignment: { mode: 'all' } });
        await forceState(campaign.id, {
          status: 'previewed',
          preview: previewWithOverlap(1),
        });

        const res = await api()
          .post(`${base}/${campaign.id}/commit`)
          .set(authHeader(superAdminToken))
          .send({
            mode: 'overwrite',
            replaceCampaignIds: [replaced],
            expectedDeleteCount: 1,
          })
          .expect(202);

        const body = res.body as MailerCampaignDto;
        expect(body.commitMode).toBe('overwrite');
        expect(body.replaceCampaignIds).toEqual([replaced]);
        expect(body.expectedDeleteCount).toBe(1);
      });
    });
  });

  describe('reads', () => {
    it('lists with live record and lead counts, and filters by agency', async () => {
      const mine = await campaigns.create({
        carrierId: allstateId,
        name: 'Assigned to the test agency',
        status: 'imported',
        source: 'vendor',
        assignment: { mode: 'agencies', agencyIds: [ctx.agencyId] },
        settings: settings({ premiumFloor: 1999 }),
      });
      const everyone = await campaigns.create({
        carrierId: allstateId,
        name: 'Everyone',
        status: 'imported',
        source: 'vendor',
        assignment: { mode: 'all', agencyIds: [] },
      });
      await campaigns.create({
        carrierId: allstateId,
        name: 'Another agency only',
        status: 'imported',
        source: 'vendor',
        assignment: { mode: 'agencies', agencyIds: [ctx.otherAgencyId] },
      });
      await mailers.create({
        campaignId: mine._id.toString(),
        visibleAgencyIds: [ctx.agencyId],
        controlNumberKeys: ['CCCC3333'],
        source: { system: 'spreadsheet' },
      });

      const res = await api()
        .get(base)
        .query({ agencyId: ctx.agencyId })
        .set(authHeader(superAdminToken))
        .expect(200);
      const body = res.body as MailerCampaignListResponse;

      // ⚠ An `all` campaign is visible to every agency, so filtering by one
      // must include it — otherwise the list contradicts the drawer.
      expect(body.items.map((row) => row.id).sort()).toEqual(
        [mine._id.toString(), everyone._id.toString()].sort(),
      );

      const row = body.items.find((item) => item.id === mine._id.toString())!;
      expect(row.recordCount).toBe(1);
      expect(row.leadsAttributed).toBe(0);
      expect(row.premiumFloor).toBe(1999);
      expect(row.visibleAgencyNames).toEqual(['Test Agency']);
      // `null` means all agencies, never "none".
      expect(
        body.items.find((item) => item.id === everyone._id.toString())!
          .visibleAgencyNames,
      ).toBeNull();
    });

    it('searches records by either control-number form or by name', async () => {
      const campaign = await campaigns.create({
        carrierId: allstateId,
        name: 'Records',
        status: 'imported',
        source: 'vendor',
        assignment: { mode: 'all', agencyIds: [] },
      });
      await mailers.create({
        campaignId: campaign._id.toString(),
        visibleAgencyIds: null,
        controlNumber: '#d3d00000-aaaa-aaaa-f00d-0000bbbbbbbb',
        newControlNumber: '0000BBBBBBBB',
        controlNumberKeys: ['D3D00000AAAAAAAAF00D0000BBBBBBBB', '0000BBBBBBBB'],
        firstName: 'Ada',
        lastName: 'Lovelace',
        source: { system: 'spreadsheet' },
      });

      const byShort = await api()
        .get(`${base}/${campaign._id.toString()}/records`)
        .query({ q: '0000-bbbb-bbbb' })
        .set(authHeader(superAdminToken))
        .expect(200);
      expect(
        (byShort.body as MailerCampaignRecordsResponse).items[0].name,
      ).toBe('Ada Lovelace');

      const byName = await api()
        .get(`${base}/${campaign._id.toString()}/records`)
        .query({ q: 'love' })
        .set(authHeader(superAdminToken))
        .expect(200);
      expect((byName.body as MailerCampaignRecordsResponse).total).toBe(1);

      const miss = await api()
        .get(`${base}/${campaign._id.toString()}/records`)
        .query({ q: 'nobody' })
        .set(authHeader(superAdminToken))
        .expect(200);
      expect((miss.body as MailerCampaignRecordsResponse).total).toBe(0);
    });

    it('searches every column the records table renders (PAC-101)', async () => {
      // The row from the original report, shape included: the vendor file had
      // no split name columns, so the importer split the combined name on the
      // first space and stored `lastName: "ANN SMITH"`.
      const campaign = await campaigns.create({
        carrierId: allstateId,
        name: 'Every column',
        status: 'imported',
        source: 'vendor',
        assignment: { mode: 'all', agencyIds: [] },
      });
      await mailers.create({
        campaignId: campaign._id.toString(),
        visibleAgencyIds: null,
        controlNumberKeys: ['EEEE5555EEEE'],
        firstName: 'MARY',
        lastName: 'ANN SMITH',
        fullName: 'MARY ANN SMITH',
        address: {
          street: '118 Country Aire Ave',
          city: 'Mcalester',
          state: 'OK',
          zip: '74501-2210',
        },
        market: 'Tulsa',
        carrierAgencyId: 'A0B9049',
        source: { system: 'spreadsheet' },
      });
      // A second row so every assertion below has something to *exclude*.
      await mailers.create({
        campaignId: campaign._id.toString(),
        visibleAgencyIds: null,
        controlNumberKeys: ['FFFF6666FFFF'],
        firstName: 'John',
        lastName: 'Doe',
        fullName: 'John Doe',
        address: { street: '1 Elm St', city: 'Bartlesville', state: 'OK' },
        market: 'Oklahoma City',
        carrierAgencyId: 'B1C2003',
        source: { system: 'spreadsheet' },
      });

      const find = async (q: string) => {
        const res = await api()
          .get(`${base}/${campaign._id.toString()}/records`)
          .query({ q })
          .set(authHeader(superAdminToken))
          .expect(200);
        return res.body as MailerCampaignRecordsResponse;
      };

      // The reproduction: copy the Name cell, paste it into the box above it.
      // Used to be an anchored `^"MARY ANN SMITH"` on first *or* last name —
      // unsatisfiable by construction.
      expect((await find('MARY ANN SMITH')).total).toBe(1);

      // A bare surname, against a last name the importer mangled.
      expect((await find('smith')).total).toBe(1);

      // Location, Market and Code: rendered columns, never previously searched.
      expect((await find('Mcalester')).total).toBe(1);
      expect((await find('Tulsa')).total).toBe(1);
      expect((await find('A0B9049')).total).toBe(1);

      // Street is not a column, but it is how the bug was found.
      expect((await find('Country Aire')).total).toBe(1);

      // Multi-token across *different* fields: a surname and a city.
      expect((await find('smith mcalester')).total).toBe(1);
      expect((await find('doe mcalester')).total).toBe(0);

      // The control number is still one indexed equality on the whole term,
      // and it is not suppressed by the token clause.
      expect((await find('eeee-5555-eeee')).total).toBe(1);

      // Both rows are in Oklahoma; a token common to both must not narrow.
      expect((await find('OK')).total).toBe(2);
    });

    it('mints a download link on click and 404s a file that does not exist', async () => {
      const campaign = await uploadCampaign();

      const res = await api()
        .get(`${base}/${campaign.id}/files/vendor/url`)
        .set(authHeader(superAdminToken))
        .expect(200);
      expect((res.body as { url: string }).url).toContain('signed=1');

      await api()
        .get(`${base}/${campaign.id}/files/output/url`)
        .set(authHeader(superAdminToken))
        .expect(404);
    });

    it('404s an unknown campaign rather than casting a bad id', async () => {
      await api()
        .get(`${base}/not-an-object-id`)
        .set(authHeader(superAdminToken))
        .expect(404);
    });
  });

  describe('delete and email', () => {
    it('discards an uploaded campaign and its vendor object', async () => {
      const campaign = await uploadCampaign();
      const key = storage.presigned[storage.presigned.length - 1];
      expect(storage.objects.has(key)).toBe(true);

      await api()
        .delete(`${base}/${campaign.id}`)
        .set(authHeader(superAdminToken))
        .expect(200);

      expect(storage.objects.has(key)).toBe(false);
      expect(await campaigns.countDocuments({ _id: campaign.id })).toBe(0);
    });

    it('refuses to delete an imported campaign', async () => {
      const campaign = await uploadCampaign();
      await forceState(campaign.id, { status: 'imported' });

      // Leads point at it through `mailer.campaignId`; attribution has to
      // outlive the run.
      await api()
        .delete(`${base}/${campaign.id}`)
        .set(authHeader(superAdminToken))
        .expect(409);
    });

    it('refuses to email an output that does not exist yet', async () => {
      const campaign = await uploadCampaign();
      await api()
        .post(`${base}/${campaign.id}/email`)
        .set(authHeader(superAdminToken))
        .send({})
        .expect(409);
    });

    it('queues the completion email for an imported campaign', async () => {
      const campaign = await uploadCampaign();
      await forceState(campaign.id, {
        status: 'imported',
        outputFile: {
          storageKey: 'platform/mailer-campaigns/2026/output/x.csv',
          name: 'SFA-QBP.csv',
          size: 10,
        },
      });

      const res = await api()
        .post(`${base}/${campaign.id}/email`)
        .set(authHeader(superAdminToken))
        .send({ recipients: ['print@example.com'] })
        .expect(202);
      expect((res.body as { queued: number }).queued).toBe(1);
    });
  });
});
