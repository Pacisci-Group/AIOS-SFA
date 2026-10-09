import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import {
  DATA_EXPORT_DATASET_KEYS,
  type DataExportDictionaryResponse,
  type DataExportFileUrlResponse,
  type DataExportHistoryResponse,
  type DataExportOptionsResponse,
  type DataExportRequestBody,
  type DataExportRequestResponse,
} from '@sfa/shared';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { NonRetriableError } from 'inngest';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Contact } from '../../src/contacts/schemas/contact.schema';
import {
  DataExport,
  type DataExportDocument,
} from '../../src/data-export/schemas/data-export.schema';
import { DealAudit } from '../../src/deal-audits/schemas/deal-audit.schema';
import { Deal } from '../../src/deals/schemas/deal.schema';
import { HouseholdMember } from '../../src/households/schemas/household-member.schema';
import { Household } from '../../src/households/schemas/household.schema';
import type { DataExportJobData } from '../../src/inngest/events';
import { EventLogService } from '../../src/inngest/event-log/event-log.service';
import { InngestService } from '../../src/inngest/inngest.service';
import { Lead } from '../../src/leads/schemas/lead.schema';
import { AccessResolverService } from '../../src/permissions/access-resolver.service';
import { RoleAssignmentsService } from '../../src/permissions/role-assignments.service';
import { Agency } from '../../src/platform/schemas/agency.schema';
import { Policy } from '../../src/policies/schemas/policy.schema';
import { QuoteRecap } from '../../src/quote-recaps/schemas/quote-recap.schema';
import { AgencyRole } from '../../src/roles/schemas/agency-role.schema';
import { StorageService } from '../../src/storage/storage.service';
import { User } from '../../src/users/schemas/user.schema';
import {
  MailTransport,
  type OutboundMessage,
  type SendResult,
} from '../../src/worker/email/mail-transport';
import { DataExportExpireFn } from '../../src/worker/functions/data-export-expire.fn';
import {
  type DataExportRun,
  DataExportGenerateFn,
} from '../../src/worker/functions/data-export-generate.fn';
import { authHeader, login } from '../helpers/auth.helper';
import { FakeStorage } from '../helpers/fake-storage';
import {
  TEST_PASSWORD,
  TestSeedContext,
  seedTestData,
} from '../helpers/seed-test-data';
import {
  CapturedInngestService,
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from '../helpers/test-app';

type Row = Record<string, string>;

/** Records what would have been mailed. */
class CaptureMailTransport extends MailTransport {
  readonly sent: Array<{ message: OutboundMessage; idempotencyKey: string }> =
    [];
  failWith: Error | null = null;

  send(message: OutboundMessage, idempotencyKey: string): Promise<SendResult> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push({ message, idempotencyKey });
    return Promise.resolve({
      providerMessageId: `capture-${this.sent.length}`,
    });
  }
}

function inlineStep() {
  const ran: string[] = [];
  return {
    ran,
    step: {
      run: async <T>(
        _id: string,
        fn: () => Promise<T> | T,
      ): Promise<unknown> => {
        ran.push(_id);
        return await fn();
      },
    },
  };
}

/**
 * The Data Export page (PAC-152), end to end: the request endpoint, the worker
 * job that produces the file, the download link, retention.
 *
 * Lives in `test/worker/` because it drives `DataExportGenerateFn` directly —
 * the one directory the worker's import boundary lets a test reach in from.
 * The app is the real `AppModule` (so the HTTP surface, guards and scope are
 * real) with object storage and the mail transport swapped for in-memory
 * doubles, and Inngest captured: each test requests an export over HTTP and
 * then runs the job itself with an inline `step`.
 *
 * Fixtures sit in May 2026 so the suite does not depend on today's date:
 *
 * | | owner | source | notes |
 * |---|---|---|---|
 * | L1 | producer | Mailer | quoted (Q1) and sold (D1); primary contact C1 |
 * | L2 | owner | Facebook | migrated date-only `createdDate`, May 10 |
 * | L3 | producer | — | `isTestRecord` — must never appear |
 * | L4 | producer | Mailer | migrated **June 1** — out of a May window |
 *
 * D1 sells two policies into household H1 (members C1, C2) with a −200
 * chargeback and a failed audit. Q1 is stored in the migrated shape
 * (`productsQuoted: ['PYgez']`, a raw SmartSuite code).
 */
describe('Data export (PAC-152) (e2e)', () => {
  let app: INestApplication<App>;
  let seed: TestSeedContext;
  let storage: FakeStorage;
  let transport: CaptureMailTransport;
  let events: CapturedInngestService;
  let generateFn: DataExportGenerateFn;
  let exportModel: Model<DataExportDocument>;
  let dataTeamToken: string;
  let producerToken: string;
  let csrToken: string;
  let producerId: string;
  let ownerId: string;
  let dataTeamId: string;
  const ids: Record<string, string> = {};

  const server = () => app.getHttpServer();

  /** `POST …/exports` — the raw response, for status assertions. */
  const post = (
    dataset: string,
    body: DataExportRequestBody | Record<string, unknown> = {},
    token = dataTeamToken,
  ) =>
    request(server())
      .post(`/api/v1/data-export/${dataset}/exports`)
      .set(authHeader(token))
      .send(body);

  /** Request an export and return its id. */
  const requestExport = async (
    dataset: string,
    body: DataExportRequestBody = {},
    token = dataTeamToken,
  ): Promise<string> => {
    const res = await post(dataset, body, token).expect(202);
    return (res.body as DataExportRequestResponse).export.id;
  };

  /** The event the API sent for an export, as the worker receives it. */
  const sentEvent = (exportId: string) => {
    const sent = events.sent.find((event) => event.data.exportId === exportId);
    if (!sent) throw new Error(`No event was sent for ${exportId}`);
    return {
      id: `evt-${exportId}`,
      name: sent.name,
      data: {
        eventLogId: sent.id ?? new Types.ObjectId().toHexString(),
        ...sent.data,
      } as DataExportJobData,
    };
  };

  /**
   * Run the worker job for an export, from the event the API sent. A single
   * attempt by default, which is therefore the final one.
   */
  const generate = async (exportId: string, run: Partial<DataExportRun> = {}) =>
    generateFn.handle(sentEvent(exportId), inlineStep().step, {
      runId: `run-${exportId}`,
      attempt: 0,
      maxAttempts: 1,
      ...run,
    });

  /**
   * Have the job fail an export on its final attempt. The registry "forgets"
   * its dataset for one run, the only way a request that validated can fail
   * to plan, then gets it back so a re-run can plan it.
   */
  const failExport = async (id: string) => {
    const row = await exportModel.findById(id).lean();
    await exportModel.updateOne({ _id: id }, { $set: { datasetKey: 'gone' } });
    await expect(generate(id)).rejects.toThrow('Unknown dataset gone');
    await exportModel.updateOne(
      { _id: id },
      { $set: { datasetKey: row!.datasetKey } },
    );
  };

  /** The stored file of a finished export. */
  const storedFile = async (exportId: string) => {
    const row = await exportModel.findById(exportId).lean();
    expect(row?.status).toBe('ready');
    const object = storage.objects.get(row!.file!.storageKey);
    expect(object).toBeDefined();
    return { row: row!, body: object!.body };
  };

  /** Request → run → parse: header + rows keyed by header. */
  const csv = async (
    dataset: string,
    body: DataExportRequestBody = {},
    token = dataTeamToken,
  ) => {
    const id = await requestExport(dataset, body, token);
    await generate(id);
    const { row, body: bytes } = await storedFile(id);
    const records = parse(bytes, { bom: true }) as string[][];
    const [header, ...rest] = records;
    return {
      id,
      row,
      header,
      rows: rest.map((cells) =>
        Object.fromEntries(header.map((key, index) => [key, cells[index]])),
      ) as Row[],
    };
  };

  const xlsx = async (dataset: string, body: DataExportRequestBody = {}) => {
    const id = await requestExport(dataset, { ...body, format: 'xlsx' });
    await generate(id);
    const { row, body: bytes } = await storedFile(id);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
    return { row, sheet: workbook.worksheets[0] };
  };

  const dictionary = async () =>
    (
      await request(server())
        .get('/api/v1/data-export/datasets')
        .set(authHeader(dataTeamToken))
        .expect(200)
    ).body as DataExportDictionaryResponse;

  beforeAll(async () => {
    storage = new FakeStorage();
    transport = new CaptureMailTransport();
    app = await createTestApp({
      overrides: [
        { provide: StorageService, useValue: storage.asService() },
        { provide: MailTransport, useValue: transport },
      ],
    });
    await dropTestDatabase(app);
    seed = await seedTestData(app);
    events = app.get(InngestService);
    generateFn = app.get(DataExportGenerateFn);
    exportModel = app.get(getModelToken(DataExport.name));
    // `dropTestDatabase` ran after `autoIndex` built the indexes, which left
    // the collection with none. The duplicate rule needs its unique index to
    // refuse a racing request: see `carrier-appointments.e2e-spec.ts`.
    await exportModel.syncIndexes();

    const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
    const userModel = model<User>(User.name);
    const roleModel = model<AgencyRole>(AgencyRole.name);
    const leadModel = model<Lead>(Lead.name);
    const dealModel = model<Deal>(Deal.name);
    const policyModel = model<Policy>(Policy.name);
    const recapModel = model<QuoteRecap>(QuoteRecap.name);
    const householdModel = model<Household>(Household.name);
    const memberModel = model<HouseholdMember>(HouseholdMember.name);
    const contactModel = model<Contact>(Contact.name);
    const auditModel = model<DealAudit>(DealAudit.name);
    const roleAssignments = app.get(RoleAssignmentsService);

    const producer = await userModel
      .findOne({ email: seed.producerEmail })
      .select('+passwordHash');
    const owner = await userModel.findOne({ email: seed.ownerEmail });
    producerId = producer!._id.toString();
    ownerId = owner!._id.toString();

    // The persona this page is for.
    const agencyId = new Types.ObjectId(seed.agencyId);
    const dataTeamRole = await roleModel
      .findOne({ agencyId, slug: 'data_team' })
      .lean();
    const dataTeam = await userModel.create({
      agencyId,
      branchId: new Types.ObjectId(seed.branchId),
      email: 'test-data-team@sfa.local',
      passwordHash: (producer as unknown as { passwordHash: string })
        .passwordHash,
      firstName: 'Dana',
      lastName: 'Data',
      isActive: true,
    });
    dataTeamId = dataTeam._id.toString();
    await roleAssignments.setUserRoles(
      { userId: ownerId, isPlatformAdmin: true },
      agencyId,
      dataTeam._id,
      [dataTeamRole!._id],
    );

    const base = { agencyId: seed.agencyId, branchId: seed.branchId };
    const mailer = new Types.ObjectId(seed.leadSourceIds.mailer);
    const facebook = new Types.ObjectId(seed.leadSourceIds.facebook);

    const c1 = await contactModel.create({
      ...base,
      firstName: 'Casey',
      lastName: 'Export',
      email: 'casey@example.com',
      phone: '555-0100',
      dateOfBirth: new Date('1980-02-29T00:00:00.000Z'),
    });
    const c2 = await contactModel.create({
      ...base,
      firstName: 'Robin',
      lastName: 'Export',
    });
    const h1 = await householdModel.create({
      ...base,
      householdRef: 'HH-2026-9001',
      name: 'Export Household',
      status: 'b5qvJ', // raw SmartSuite code for Active
      primaryContactId: c1._id,
      assignedCrmId: owner!._id,
      propertyAddress: {
        street: '1 Main St',
        street2: 'Apt 2',
        city: 'Tulsa',
        state: 'OK',
        zip: '74103',
      },
    });
    await memberModel.create([
      {
        ...base,
        householdId: h1._id,
        contactId: c1._id,
        role: 'Named Insured',
        addedAt: new Date('2026-05-01'),
      },
      {
        ...base,
        householdId: h1._id,
        contactId: c2._id,
        role: 'Spouse',
        addedAt: new Date('2026-05-02'),
      },
    ]);

    const lead = (fields: Record<string, unknown>) =>
      leadModel.create({
        ...base,
        firstName: 'Lead',
        lastName: 'Fixture',
        status: 'New',
        temperature: 'Warm',
        ...fields,
      });
    const l1 = await lead({
      producerId: producer!._id,
      leadSourceId: mailer,
      householdId: h1._id,
      primaryContactId: c1._id,
      createdDate: new Date('2026-05-03T15:00:00.000Z'),
    });
    const l2 = await lead({
      producerId: owner!._id,
      leadSourceId: facebook,
      createdDate: new Date('2026-05-10T00:00:00.000Z'),
    });
    const l3 = await lead({
      producerId: producer!._id,
      isTestRecord: true,
      createdDate: new Date('2026-05-04T15:00:00.000Z'),
    });
    const l4 = await lead({
      producerId: producer!._id,
      leadSourceId: mailer,
      createdDate: new Date('2026-06-01T00:00:00.000Z'),
    });

    const q1 = await recapModel.create({
      ...base,
      producerId: producer!._id,
      leadId: l1._id,
      householdId: h1._id,
      quoteDate: new Date('2026-05-04T12:00:00.000Z'),
      quoteDateYmd: 20260504,
      premium: 5000,
      itemCount: 3,
      productsQuoted: ['PYgez'],
    });
    const d1 = await dealModel.create({
      ...base,
      producerId: producer!._id,
      leadId: l1._id,
      quoteRecapId: q1._id,
      householdId: h1._id,
      soldDateYmd: 20260520,
      premium: 3000,
      chargebackAdjustment: -200,
      itemCount: 4,
      policyTypes: ['Auto', 'Home'],
    });
    const [p1] = await policyModel.create([
      {
        ...base,
        dealId: d1._id,
        householdId: h1._id,
        policyNumber: '00777',
        policyType: 'Auto',
        policyStatus: 'Active',
        premium: 1200,
        items: 3,
        effectiveDate: new Date('2026-05-20T00:00:00.000Z'),
      },
      {
        ...base,
        dealId: d1._id,
        householdId: h1._id,
        policyNumber: '00778',
        policyType: 'Home',
        policyStatus: 'Cancelled',
        premium: 1800,
        items: 1,
        effectiveDate: new Date('2026-05-21T00:00:00.000Z'),
      },
    ]);
    await auditModel.create({
      ...base,
      dealId: d1._id,
      auditStatus: 'Fail',
      itemCount: 4,
      resolvedCount: 2,
      openFailedCount: 1,
    });

    Object.assign(ids, {
      c1: c1._id.toString(),
      c2: c2._id.toString(),
      h1: h1._id.toString(),
      l1: l1._id.toString(),
      l2: l2._id.toString(),
      l3: l3._id.toString(),
      l4: l4._id.toString(),
      q1: q1._id.toString(),
      d1: d1._id.toString(),
      p1: p1._id.toString(),
    });

    dataTeamToken = (
      await login(app, 'test-data-team@sfa.local', TEST_PASSWORD)
    ).accessToken;
    producerToken = (await login(app, seed.producerEmail, TEST_PASSWORD))
      .accessToken;
    csrToken = (await login(app, seed.csrEmail, TEST_PASSWORD)).accessToken;
  });

  /**
   * Tests ask for the same export again and again. Releasing every live
   * export's key between tests stands in for those exports having expired, so
   * the duplicate rule only applies inside a test, where `duplicates` and
   * `re-running a failed export` check it.
   */
  beforeEach(async () => {
    await exportModel.updateMany(
      { activeKey: { $type: 'string' } },
      { $set: { activeKey: null } },
    );
  });

  afterAll(async () => {
    delete process.env.DATA_EXPORT_MAX_ROWS;
    // Suites share one database, and a later one may seed without dropping.
    await dropTestDatabase(app);
    await closeTestApp(app);
  });

  describe('access', () => {
    it('refuses a role without data_export:read', async () => {
      await request(server())
        .get('/api/v1/data-export/datasets')
        .set(authHeader(csrToken))
        .expect(403);
      await post('leads', {}, producerToken).expect(403);
    });

    it('refuses everyone, the Data Team included, while the module is disabled', async () => {
      const agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
      const resolver = app.get(AccessResolverService);
      await agencies.updateOne(
        { _id: seed.agencyId },
        { $set: { 'modules.data_export.enabled': false } },
      );
      await resolver.invalidateAgency(seed.agencyId);
      try {
        await request(server())
          .get('/api/v1/data-export/datasets')
          .set(authHeader(dataTeamToken))
          .expect(403);
        await post('leads').expect(403);
      } finally {
        await agencies.updateOne(
          { _id: seed.agencyId },
          { $set: { 'modules.data_export.enabled': true } },
        );
        await resolver.invalidateAgency(seed.agencyId);
      }
    });
  });

  describe('dictionary', () => {
    it('describes every dataset, both formats and the cap', async () => {
      const body = await dictionary();
      expect(body.datasets.map((d) => d.key)).toEqual([
        ...DATA_EXPORT_DATASET_KEYS,
      ]);
      expect(body.formats).toEqual(['csv', 'xlsx']);
      expect(body.maxRows).toBe(100_000);
      for (const dataset of body.datasets) {
        expect(dataset.dateFields.filter((f) => f.isDefault)).toHaveLength(1);
        for (const column of dataset.columns) {
          expect(column.key).not.toMatch(
            /(^|_)(key|token|secret|hash|password)s?$/,
          );
        }
      }
    });
  });

  describe('requesting an export', () => {
    it('queues it, records who asked and hands it to the worker', async () => {
      const res = await post('leads', {
        format: 'csv',
        from: '2026-05-01',
        to: '2026-05-31',
      }).expect(202);
      const row = (res.body as DataExportRequestResponse).export;
      expect(row).toMatchObject({
        status: 'queued',
        datasetKey: 'leads',
        datasetLabel: 'Leads',
        format: 'csv',
        canDownload: false,
        expiresAt: null,
        createdById: dataTeamId,
        createdByName: 'Dana Data',
        filename: 'test-agency_leads_2026-05-01_2026-05-31.csv',
      });

      const event = events.sent.find((e) => e.data.exportId === row.id)!;
      expect(event.name).toBe('data-export/export.requested.v1');
      expect(event.data).toMatchObject({
        agencyId: seed.agencyId,
        requestedBy: dataTeamId,
      });

      // The worker re-plans from this, so it must say who asked and how far
      // they could see — never a pipeline.
      const stored = await exportModel.findById(row.id).lean();
      expect(stored!.scope).toMatchObject({
        userId: dataTeamId,
        dataScope: 'agency',
      });
      expect(typeof stored!.scope!.timeZone).toBe('string');
      expect(stored!.filters).toMatchObject({
        from: '2026-05-01',
        to: '2026-05-31',
        dateField: 'created',
      });

      // The row points at its job: the id was minted before the send and
      // handed to it, so it is the outbox row's `_id` and the Inngest event id.
      expect(event.id).toMatch(/^[0-9a-f]{24}$/);
      expect(stored!.eventLogId).toBe(event.id);
      expect(stored!.runId).toBeNull();
    });

    it('has no file to hand out until the job has run', async () => {
      const id = await requestExport('contacts');
      await request(server())
        .get(`/api/v1/data-export/exports/${id}/url`)
        .set(authHeader(dataTeamToken))
        .expect(409);
    });

    it.each([
      ['to before from', 'leads', { from: '2026-05-31', to: '2026-05-01' }],
      ['an impossible date', 'leads', { from: '2026-02-31' }],
      ['an unknown date field', 'leads', { dateField: 'nonsense' }],
      ['an unknown format', 'leads', { format: 'pdf' }],
      ['an unknown status', 'leads', { status: ['Bogus'] }],
    ])(
      'rejects %s with a 400, queuing nothing',
      async (_label, dataset, body) => {
        const before = events.sent.length;
        await post(dataset, body).expect(400);
        expect(events.sent.length).toBe(before);
      },
    );

    it('rejects a filter the dataset cannot apply', async () => {
      await post('contacts', { producerIds: [ownerId] }).expect(400);
    });

    it('rejects an unknown dataset with a 400', async () => {
      await post('nope').expect(400);
    });
  });

  describe('the file', () => {
    it.each(DATA_EXPORT_DATASET_KEYS)(
      '%s: CSV header matches the dictionary',
      async (key) => {
        const columns = (await dictionary()).datasets.find(
          (d) => d.key === key,
        )!.columns;
        const { header, row } = await csv(key);
        expect(row.file!.contentType).toContain('text/csv');
        expect(row.filename).toBe(`test-agency_${key}_all_all.csv`);
        expect(row.file!.storageKey).toMatch(
          new RegExp(
            `^agencies/${seed.agencyId}/data-exports/\\d{4}/${String(row._id)}/test-agency_${key}_all_all\\.csv$`,
          ),
        );
        expect(header).toEqual(columns.map((column) => column.key));
        expect(row.bytes).toBeGreaterThan(0);
        expect(row.rowCount).toBeGreaterThan(0);
      },
    );

    it.each(DATA_EXPORT_DATASET_KEYS)(
      '%s: XLSX opens, with the same header row',
      async (key) => {
        const columns = (await dictionary()).datasets.find(
          (d) => d.key === key,
        )!.columns;
        const { row, sheet } = await xlsx(key);
        expect(row.file!.contentType).toBe(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        expect(row.filename).toBe(`test-agency_${key}_all_all.xlsx`);
        expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual(
          columns.map((c) => c.key),
        );
      },
    );

    it('leads: resolves names and outcomes, and never exports a test record', async () => {
      const { rows } = await csv('leads');
      const byId = new Map(rows.map((row) => [row.lead_id, row]));
      expect(byId.has(ids.l3)).toBe(false);

      const l1 = byId.get(ids.l1)!;
      expect(l1.producer_id).toBe(producerId);
      expect(l1.producer_name).toBeTruthy();
      expect(l1.lead_source_name).toBe('Mailer');
      expect(l1.status).toBe('New');
      expect(l1.household_ref).toBe('HH-2026-9001');
      expect(l1.primary_contact_name).toBe('Casey Export');
      expect(l1.primary_contact_email).toBe('casey@example.com');
      expect(l1.primary_contact_date_of_birth).toBe('1980-02-29');
      expect(l1.created_date).toBe('2026-05-03');
      expect(l1.quoted).toBe('true');
      expect(l1.latest_quote_recap_id).toBe(ids.q1);
      expect(l1.sold).toBe('true');
      expect(l1.first_deal_id).toBe(ids.d1);
      expect(l1.first_sold_date).toBe('2026-05-20');

      // A migrated date-only value reads as the date it names, not as the
      // evening before in Chicago.
      expect(byId.get(ids.l2)!.created_date).toBe('2026-05-10');
      expect(byId.get(ids.l2)!.sold).toBe('false');
    });

    it('quote recaps: normalises raw product codes and finds the converted deal', async () => {
      const { rows } = await csv('quote_recaps');
      const q1 = rows.find((row) => row.quote_recap_id === ids.q1)!;
      expect(q1.products_quoted).toBe('Auto');
      expect(q1.products_quoted_raw).toBe('PYgez');
      expect(q1.quote_date).toBe('2026-05-04');
      expect(q1.lead_source_name).toBe('Mailer');
      expect(q1.primary_contact_name).toBe('Casey Export');
      expect(q1.converted).toBe('true');
      expect(q1.converted_matched_by).toBe('quote_recap');
      expect(q1.converted_deal_id).toBe(ids.d1);
      expect(q1.days_to_close).toBe('16');
    });

    it('sold deals: rolls up policies, net premium and the audit', async () => {
      const { rows } = await csv('sold_deals');
      const d1 = rows.find((row) => row.deal_id === ids.d1)!;
      expect(d1.policy_numbers).toBe('00777; 00778');
      expect(d1.policy_count).toBe('2');
      expect(d1.policy_statuses).toBe('Active; Cancelled');
      expect(d1.premium).toBe('3000');
      expect(d1.chargeback_adjustment).toBe('-200');
      expect(d1.net_premium).toBe('2800');
      expect(d1.sold_year).toBe('2026');
      expect(d1.sold_month_name).toBe('May');
      expect(d1.lead_source_name).toBe('Mailer');
      expect(d1.deal_audit_status).toBe('Fail');
      expect(d1.audit_open_failed_count).toBe('1');
      expect(d1.business_type).toBe('new_business');
    });

    it('policies: names the household, its CRM and the selling producer', async () => {
      const { rows } = await csv('policies');
      const p1 = rows.find((row) => row.policy_id === ids.p1)!;
      expect(p1.policy_number).toBe('00777');
      expect(p1.is_active).toBe('true');
      expect(p1.effective_date).toBe('2026-05-20');
      expect(p1.household_ref).toBe('HH-2026-9001');
      expect(p1.household_property_street2).toBe('Apt 2');
      expect(p1.client_relations_manager_id).toBe(ownerId);
      expect(p1.deal_producer_id).toBe(producerId);
      expect(p1.sold_date).toBe('2026-05-20');
    });

    it('households: lists current members as aligned lists and recomputes active policies', async () => {
      const { rows } = await csv('households');
      const h1 = rows.find((row) => row.household_id === ids.h1)!;
      expect(h1.status).toBe('Active');
      expect(h1.status_raw).toBe('b5qvJ');
      expect(h1.member_count).toBe('2');
      expect(h1.member_contact_ids).toBe(`${ids.c1}; ${ids.c2}`);
      expect(h1.member_names).toBe('Casey Export; Robin Export');
      expect(h1.policy_count).toBe('2');
      expect(h1.active_policy_count).toBe('1');
      expect(h1.active_policy_numbers).toBe('00777');
    });

    it('contacts: one row per person, with their households', async () => {
      const { rows } = await csv('contacts');
      const c1 = rows.find((row) => row.contact_id === ids.c1)!;
      expect(c1.date_of_birth).toBe('1980-02-29');
      expect(c1.household_refs).toBe('HH-2026-9001');
      expect(c1.primary_contact_of_household_ids).toBe(ids.h1);
    });

    it('xlsx: ids stay text and dates are dates', async () => {
      const { sheet } = await xlsx('policies');
      const header = (sheet.getRow(1).values as unknown[]).slice(1) as string[];
      const col = (name: string) => header.indexOf(name) + 1;
      let found = false;
      sheet.eachRow((row, index) => {
        if (index === 1 || row.getCell(col('policy_id')).value !== ids.p1)
          return;
        found = true;
        expect(row.getCell(col('policy_number')).value).toBe('00777');
        expect(row.getCell(col('effective_date')).value).toEqual(
          new Date('2026-05-20T00:00:00.000Z'),
        );
        expect(row.getCell(col('premium')).value).toBe(1200);
      });
      expect(found).toBe(true);
    });
  });

  describe('filters', () => {
    it('windows leads on the agency calendar, `to` inclusive', async () => {
      const { rows, row } = await csv('leads', {
        from: '2026-05-01',
        to: '2026-05-31',
      });
      const leadIds = rows.map((r) => r.lead_id);
      expect(leadIds).toEqual(expect.arrayContaining([ids.l1, ids.l2]));
      expect(leadIds).not.toContain(ids.l4);
      expect(row.filename).toBe('test-agency_leads_2026-05-01_2026-05-31.csv');
    });

    it('leaves an open end open', async () => {
      const { rows } = await csv('leads', { from: '2026-05-15' });
      expect(rows.map((row) => row.lead_id)).toContain(ids.l4);
      expect(rows.map((row) => row.lead_id)).not.toContain(ids.l1);
    });

    it('applies the window to the chosen date field', async () => {
      const inMay = await csv('policies', {
        dateField: 'effective_date',
        from: '2026-05-21',
        to: '2026-05-21',
      });
      expect(inMay.rows.map((row) => row.policy_number)).toEqual(['00778']);
    });

    it('filters by producer, lead source, status and policy type', async () => {
      const byProducer = await csv('leads', { producerIds: [ownerId] });
      expect(byProducer.rows.map((row) => row.lead_id)).toEqual([ids.l2]);

      const bySource = await csv('sold_deals', {
        leadSourceIds: [seed.leadSourceIds.mailer],
      });
      expect(bySource.rows.map((row) => row.deal_id)).toContain(ids.d1);
      const byOtherSource = await csv('sold_deals', {
        leadSourceIds: [seed.leadSourceIds.facebook],
      });
      expect(byOtherSource.rows.map((row) => row.deal_id)).not.toContain(
        ids.d1,
      );

      const cancelled = await csv('policies', { status: ['Cancelled'] });
      expect(cancelled.rows.map((row) => row.policy_number)).toContain('00778');
      expect(cancelled.rows.map((row) => row.policy_number)).not.toContain(
        '00777',
      );

      // The raw code on Q1 still matches its label.
      const auto = await csv('quote_recaps', { policyTypes: ['Auto'] });
      expect(auto.rows.map((row) => row.quote_recap_id)).toContain(ids.q1);
    });
  });

  describe('data scope', () => {
    beforeAll(async () => {
      await app
        .get(RoleAssignmentsService)
        .setUserOverrides(seed.agencyId, producerId, ['data_export:read'], []);
      await app.get(AccessResolverService).invalidateUser(producerId);
    });

    it('pins a producer to their own leads, whatever producer they ask for', async () => {
      const own = await csv('leads', {}, producerToken);
      expect(new Set(own.rows.map((row) => row.producer_id))).toEqual(
        new Set([producerId]),
      );

      const widened = await csv(
        'leads',
        { producerIds: [ownerId] },
        producerToken,
      );
      expect(widened.rows.map((row) => row.lead_id)).not.toContain(ids.l2);
    });

    it("gives a producer their branch's client records, never another branch's", async () => {
      const { rows } = await csv('households', {}, producerToken);
      const householdIds = rows.map((row) => row.household_id);
      expect(householdIds).toContain(ids.h1);
      expect(householdIds).not.toContain(seed.otherBranchHouseholdId);
      expect(householdIds).not.toContain(seed.otherAgencyHouseholdId);
    });

    it('lets an agency-scope caller narrow to a branch, and nobody else', async () => {
      const all = await csv('households');
      expect(all.rows.map((row) => row.household_id)).toContain(
        seed.otherBranchHouseholdId,
      );

      const mainOnly = await csv('households', { branchId: seed.branchId });
      expect(mainOnly.rows.map((row) => row.household_id)).not.toContain(
        seed.otherBranchHouseholdId,
      );
      expect(new Set(mainOnly.rows.map((row) => row.branch_id))).toEqual(
        new Set([seed.branchId]),
      );
    });

    it('lists only what the caller may pick', async () => {
      const options = (token: string) =>
        request(server())
          .get('/api/v1/data-export/options')
          .set(authHeader(token))
          .expect(200);
      const team = (await options(dataTeamToken))
        .body as DataExportOptionsResponse;
      expect(team.branches.length).toBeGreaterThanOrEqual(2);
      expect(team.producers.map((p) => p.id)).toContain(producerId);

      const self = (await options(producerToken))
        .body as DataExportOptionsResponse;
      expect(self.producers.map((p) => p.id)).toEqual([producerId]);
      expect(self.branches.map((b) => b.id)).toEqual([seed.branchId]);
    });

    it("never hands one user another's file under own scope", async () => {
      const teamExport = await requestExport('contacts');
      await generate(teamExport);
      await request(server())
        .get(`/api/v1/data-export/exports/${teamExport}/url`)
        .set(authHeader(producerToken))
        .expect(404);
    });
  });

  describe('the job', () => {
    it('stores the file, emails the requester and offers a download link', async () => {
      transport.sent.length = 0;
      const id = await requestExport('sold_deals', { format: 'xlsx' });
      await generate(id);

      const { row } = await storedFile(id);
      expect(row.truncated).toBe(false);
      expect(row.startedAt).toBeInstanceOf(Date);
      expect(row.finishedAt).toBeInstanceOf(Date);
      // Seven days by default.
      expect(row.expiresAt!.getTime() - row.finishedAt!.getTime()).toBe(
        7 * 86_400_000,
      );
      expect(row.notification).toMatchObject({
        to: 'test-data-team@sfa.local',
        error: null,
      });
      expect(row.notification!.sentAt).toBeInstanceOf(Date);

      const mail = transport.sent.find(
        (sent) => sent.idempotencyKey === `data-export:${id}`,
      )!;
      expect(mail.message.to).toBe('test-data-team@sfa.local');
      expect(mail.message.subject).toBe('Your Sold deals export is ready');
      expect(mail.message.text).toContain('/data-export');
      // The page, never the file: a bearer link must not sit in an inbox.
      expect(mail.message.text).not.toContain('storage.test');

      const before = storage.downloads.length;
      const res = await request(server())
        .get(`/api/v1/data-export/exports/${id}/url`)
        .set(authHeader(dataTeamToken))
        .expect(200);
      const link = res.body as DataExportFileUrlResponse;
      expect(link.filename).toBe('test-agency_sold_deals_all_all.xlsx');
      expect(link.expiresIn).toBe(300);
      expect(storage.downloads[before]).toMatchObject({
        key: row.file!.storageKey,
        disposition: 'attachment',
        filename: 'test-agency_sold_deals_all_all.xlsx',
      });
      const after = await exportModel.findById(id).lean();
      expect(after!.downloadCount).toBe(1);
      expect(after!.lastDownloadedAt).toBeInstanceOf(Date);
    });

    it('runs once: a replayed event is a no-op', async () => {
      const id = await requestExport('contacts');
      await generate(id);
      const first = await exportModel.findById(id).lean();
      expect(await generate(id)).toEqual({ status: 'skipped' });
      const second = await exportModel.findById(id).lean();
      expect(second!.finishedAt).toEqual(first!.finishedAt);
    });

    it('never runs a request that was refused at the cap', async () => {
      process.env.DATA_EXPORT_MAX_ROWS = '1';
      try {
        await post('leads').expect(400);
      } finally {
        delete process.env.DATA_EXPORT_MAX_ROWS;
      }
      const refused = await exportModel
        .findOne({ error: 'EXPORT_TOO_LARGE' })
        .sort({ createdAt: -1 })
        .lean();
      events.sent.push({
        name: 'data-export/export.requested.v1',
        data: {
          exportId: String(refused!._id),
          agencyId: seed.agencyId,
          requestedBy: dataTeamId,
        },
      });
      expect(await generate(String(refused!._id))).toEqual({
        status: 'skipped',
      });
      const after = await exportModel.findById(refused!._id).lean();
      expect(after).toMatchObject({
        status: 'failed',
        file: null,
        eventLogId: null,
      });
    });

    it('stamps the run that claimed it', async () => {
      const id = await requestExport('contacts');
      await generate(id, { runId: 'run-abc' });
      const row = await exportModel.findById(id).lean();
      expect(row!.runId).toBe('run-abc');
    });

    it('leaves a failed export failed when its event is replayed', async () => {
      const id = await requestExport('contacts');
      await failExport(id);
      // Re-run is the way back. A replay would skip the duplicate rule and
      // the requester's current access, which Re-run goes through.
      await expect(generate(id)).resolves.toEqual({ status: 'skipped' });
      expect((await exportModel.findById(id).lean())!.status).toBe('failed');
    });

    it('stops at the cap when rows arrive between the request and the run', async () => {
      const id = await requestExport('leads');
      process.env.DATA_EXPORT_MAX_ROWS = '1';
      try {
        await generate(id);
      } finally {
        delete process.env.DATA_EXPORT_MAX_ROWS;
      }
      const { row, body } = await storedFile(id);
      expect(row.truncated).toBe(true);
      expect(row.rowCount).toBe(1);
      expect((parse(body, { bom: true }) as string[][]).length).toBe(2);
    });

    it('keeps the export processing, with the error, until the final attempt', async () => {
      const id = await requestExport('contacts');
      await exportModel.updateOne(
        { _id: id },
        { $set: { datasetKey: 'gone' } },
      );
      await expect(
        generate(id, { attempt: 0, maxAttempts: 3 }),
      ).rejects.toThrow('Unknown dataset gone');
      const row = await exportModel.findById(id).lean();
      expect(row).toMatchObject({ status: 'processing', finishedAt: null });
      expect(row!.error).toContain('Unknown dataset');
    });

    it('fails the export at once on an error Inngest will not retry', async () => {
      const id = await requestExport('contacts');
      const put = jest
        .spyOn(app.get(StorageService), 'putObjectFromFile')
        .mockRejectedValueOnce(new NonRetriableError('bucket gone'));
      try {
        await expect(
          generate(id, { attempt: 0, maxAttempts: 3 }),
        ).rejects.toThrow('bucket gone');
      } finally {
        put.mockRestore();
      }
      expect(await exportModel.findById(id).lean()).toMatchObject({
        status: 'failed',
        error: 'bucket gone',
        activeKey: null,
      });
    });

    it('marks the export failed and rethrows when it cannot be produced', async () => {
      const id = await requestExport('contacts');
      // A dataset the registry no longer knows — the only way a request that
      // validated can fail to plan.
      await exportModel.updateOne(
        { _id: id },
        { $set: { datasetKey: 'gone' } },
      );
      await expect(generate(id)).rejects.toThrow('Unknown dataset gone');
      const row = await exportModel.findById(id).lean();
      expect(row).toMatchObject({ status: 'failed', file: null });
      expect(row!.error).toContain('Unknown dataset');
    });

    describe('when the run fails outside the handler (onFailure)', () => {
      const failure = (exportId: string, message: string) => ({
        event: {
          data: {
            run_id: 'run-dead',
            event: { data: sentEvent(exportId).data },
          },
        },
        error: new Error(message),
      });

      it('fails an export left processing and closes its event-log row', async () => {
        const id = await requestExport('contacts');
        // The worker claimed it, then died on the final attempt.
        await exportModel.updateOne(
          { _id: id },
          { $set: { status: 'processing', startedAt: new Date() } },
        );
        const eventLog = app.get(EventLogService);
        const findById = jest
          .spyOn(eventLog, 'findById')
          .mockResolvedValue({ status: 'pending' } as never);
        const markFailed = jest
          .spyOn(eventLog, 'markFailed')
          .mockResolvedValue();
        try {
          await generateFn.fail(failure(id, 'worker lost'));
          const row = await exportModel.findById(id).lean();
          expect(row).toMatchObject({ status: 'failed', error: 'worker lost' });
          expect(row!.finishedAt).toBeInstanceOf(Date);
          expect(markFailed).toHaveBeenCalledWith(
            row!.eventLogId,
            'run-dead',
            2,
            'worker lost',
          );
        } finally {
          findById.mockRestore();
          markFailed.mockRestore();
        }
      });

      it('never overwrites an event-log row the middleware already closed', async () => {
        const id = await requestExport('contacts');
        // A run Inngest failed without `guard` failing the row, after the
        // middleware recorded the real attempt count.
        await exportModel.updateOne(
          { _id: id },
          { $set: { status: 'processing', startedAt: new Date() } },
        );
        const eventLog = app.get(EventLogService);
        const findById = jest
          .spyOn(eventLog, 'findById')
          .mockResolvedValue({ status: 'failed' } as never);
        const markFailed = jest.spyOn(eventLog, 'markFailed');
        try {
          await generateFn.fail(failure(id, 'gave up'));
          expect((await exportModel.findById(id).lean())!.status).toBe(
            'failed',
          );
          expect(markFailed).not.toHaveBeenCalled();
        } finally {
          findById.mockRestore();
          markFailed.mockRestore();
        }
      });

      it('leaves an export the handler already finished alone', async () => {
        const id = await requestExport('contacts');
        await generate(id);
        const before = await exportModel.findById(id).lean();
        const markFailed = jest.spyOn(app.get(EventLogService), 'markFailed');
        try {
          await generateFn.fail(failure(id, 'late'));
          const after = await exportModel.findById(id).lean();
          expect(after!.status).toBe('ready');
          expect(after!.error).toBe(before!.error);
          expect(markFailed).not.toHaveBeenCalled();
        } finally {
          markFailed.mockRestore();
        }
      });
    });

    it('keeps a finished export ready when the email cannot be sent', async () => {
      const id = await requestExport('contacts');
      transport.failWith = new Error('provider down');
      try {
        await expect(generate(id)).resolves.toEqual({ status: 'ready' });
      } finally {
        transport.failWith = null;
      }
      const row = await exportModel.findById(id).lean();
      expect(row!.status).toBe('ready');
      expect(row!.notification).toMatchObject({
        sentAt: null,
        error: 'provider down',
      });
    });
  });

  describe('retention', () => {
    it('deletes files past their expiry, keeps the row, and stops offering the link', async () => {
      const id = await requestExport('contacts');
      await generate(id);
      const { row } = await storedFile(id);
      await exportModel.updateOne(
        { _id: id },
        { $set: { expiresAt: new Date(Date.now() - 1_000) } },
      );

      // Past expiry but not yet swept: already refused.
      await request(server())
        .get(`/api/v1/data-export/exports/${id}/url`)
        .set(authHeader(dataTeamToken))
        .expect(410);

      const { expired } = await app.get(DataExportExpireFn).sweep();
      expect(expired).toBeGreaterThanOrEqual(1);
      expect(storage.objects.has(row.file!.storageKey)).toBe(false);
      const after = await exportModel.findById(id).lean();
      expect(after).toMatchObject({ status: 'expired', file: null });

      await request(server())
        .get(`/api/v1/data-export/exports/${id}/url`)
        .set(authHeader(dataTeamToken))
        .expect(410);
    });

    it('leaves a file that has not expired', async () => {
      const id = await requestExport('contacts');
      await generate(id);
      const { row } = await storedFile(id);
      await app.get(DataExportExpireFn).sweep();
      expect(storage.objects.has(row.file!.storageKey)).toBe(true);
    });
  });

  describe('duplicates', () => {
    const april = {
      format: 'csv',
      from: '2026-04-01',
      to: '2026-04-30',
    } as const;

    it('refuses the same request while the first is queued, and logs nothing', async () => {
      const first = await requestExport('leads', {
        ...april,
        producerIds: [producerId, ownerId],
      });
      const events0 = events.sent.length;
      const rows0 = await exportModel.countDocuments();

      // The same producers in another order are the same export.
      const res = await post('leads', {
        ...april,
        producerIds: [ownerId, producerId],
      }).expect(409);
      expect(res.body).toMatchObject({
        code: 'EXPORT_DUPLICATE',
        existing: { id: first, status: 'queued' },
      });
      expect((res.body as { message: string }).message).toContain(
        'still being prepared',
      );
      expect(events.sent.length).toBe(events0);
      expect(await exportModel.countDocuments()).toBe(rows0);
    });

    it('still refuses it once the export is ready', async () => {
      const first = await requestExport('leads', april);
      await generate(first);
      const res = await post('leads', april).expect(409);
      expect(res.body).toMatchObject({
        code: 'EXPORT_DUPLICATE',
        existing: { id: first, status: 'ready', canDownload: true },
      });
      expect((res.body as { message: string }).message).toContain('Download');
    });

    it('treats another format, date field or filter as another export', async () => {
      await requestExport('leads', april);
      await post('leads', { ...april, format: 'xlsx' }).expect(202);
      await post('leads', { ...april, to: '2026-04-29' }).expect(202);
      await post('leads', { ...april, status: ['Sold'] }).expect(202);
    });

    it('lets another user ask for the same thing', async () => {
      await requestExport('contacts', { format: 'xlsx' });
      await post('contacts', { format: 'xlsx' }, producerToken).expect(202);
    });

    it('allows the request again once the export has failed', async () => {
      const first = await requestExport('leads', april);
      await failExport(first);
      expect(await exportModel.findById(first).lean()).toMatchObject({
        status: 'failed',
        activeKey: null,
      });
      await post('leads', april).expect(202);
    });

    it('allows it again once the file has expired, swept or not', async () => {
      const first = await requestExport('leads', april);
      await generate(first);
      await exportModel.updateOne(
        { _id: first },
        { $set: { expiresAt: new Date(Date.now() - 1_000) } },
      );
      // Not swept yet: the page already offers no download, so neither
      // does the rule hold the request back.
      const second = await requestExport('leads', april);
      expect(await exportModel.findById(first).lean()).toMatchObject({
        status: 'ready',
        activeKey: null,
      });

      await generate(second);
      await exportModel.updateOne(
        { _id: second },
        { $set: { expiresAt: new Date(Date.now() - 1_000) } },
      );
      await app.get(DataExportExpireFn).sweep();
      expect(await exportModel.findById(second).lean()).toMatchObject({
        status: 'expired',
        activeKey: null,
      });
      await post('leads', april).expect(202);
    });

    it('lets only one of two identical requests racing each other through', async () => {
      // The pre-check alone cannot stop a race; the unique index does.
      const indexes = await exportModel.collection.indexes();
      expect(indexes.find((index) => index.key.activeKey === 1)).toMatchObject({
        unique: true,
      });
      const statuses = (
        await Promise.all([post('policies', april), post('policies', april)])
      )
        .map((res) => res.status)
        .sort();
      expect(statuses).toEqual([202, 409]);
    });
  });

  describe('re-running a failed export', () => {
    const march = {
      format: 'xlsx',
      from: '2026-03-01',
      to: '2026-03-31',
    } as const;

    const rerun = (id: string, token = dataTeamToken) =>
      request(server())
        .post(`/api/v1/data-export/exports/${id}/rerun`)
        .set(authHeader(token));

    const historyRow = async (id: string, token = dataTeamToken) => {
      const res = await request(server())
        .get('/api/v1/data-export/history?pageSize=100')
        .set(authHeader(token))
        .expect(200);
      return (res.body as DataExportHistoryResponse).items.find(
        (item) => item.id === id,
      );
    };

    /** Request an export and have the job fail it on its final attempt. */
    const failedExport = async (
      dataset: string,
      body: DataExportRequestBody,
      token = dataTeamToken,
    ) => {
      const id = await requestExport(dataset, body, token);
      await failExport(id);
      return id;
    };

    it('queues a new export with the same parameters, and links the two', async () => {
      const failed = await failedExport('leads', march);
      expect(await historyRow(failed)).toMatchObject({
        status: 'failed',
        canRerun: true,
        rerunOfId: null,
      });

      const res = await rerun(failed).expect(202);
      const row = (res.body as DataExportRequestResponse).export;
      expect(row.id).not.toBe(failed);
      expect(row).toMatchObject({
        status: 'queued',
        datasetKey: 'leads',
        format: 'xlsx',
        rerunOfId: failed,
        canRerun: false,
        createdById: dataTeamId,
        filters: { from: '2026-03-01', to: '2026-03-31', dateField: 'created' },
      });
      expect(events.sent.some((event) => event.data.exportId === row.id)).toBe(
        true,
      );

      // The failed export stays in the log, without its Re-run action.
      expect(await historyRow(failed)).toMatchObject({
        status: 'failed',
        canRerun: false,
      });
      await rerun(failed).expect(409);

      await expect(generate(row.id)).resolves.toEqual({ status: 'ready' });
    });

    it('is refused as a duplicate when the same export was requested again', async () => {
      const failed = await failedExport('leads', march);
      const again = await requestExport('leads', march);
      const res = await rerun(failed).expect(409);
      expect(res.body).toMatchObject({
        code: 'EXPORT_DUPLICATE',
        existing: { id: again },
      });
      // Still offered: the duplicate may fail too.
      expect((await historyRow(failed))!.canRerun).toBe(true);
    });

    it('only re-runs a failed export', async () => {
      const queued = await requestExport('households', march);
      await rerun(queued).expect(409);
      expect((await historyRow(queued))!.canRerun).toBe(false);
    });

    it('hides Re-run once a re-run is refused as too large', async () => {
      const failed = await failedExport('leads', {});
      process.env.DATA_EXPORT_MAX_ROWS = '1';
      try {
        const res = await rerun(failed).expect(400);
        expect(res.body).toMatchObject({ code: 'EXPORT_TOO_LARGE' });
      } finally {
        delete process.env.DATA_EXPORT_MAX_ROWS;
      }
      const refusal = await exportModel
        .findOne({ rerunOf: new Types.ObjectId(failed) })
        .lean();
      expect(refusal).toMatchObject({
        status: 'failed',
        error: 'EXPORT_TOO_LARGE',
      });
      // The refusal answers the failed export; another click would only log
      // the same refusal again.
      expect((await historyRow(failed))!.canRerun).toBe(false);
      await rerun(failed).expect(409);
    });

    it('does not re-run an export refused as too large', async () => {
      process.env.DATA_EXPORT_MAX_ROWS = '1';
      try {
        await post('leads').expect(400);
      } finally {
        delete process.env.DATA_EXPORT_MAX_ROWS;
      }
      const refused = await exportModel
        .findOne({ error: 'EXPORT_TOO_LARGE' })
        .sort({ createdAt: -1 })
        .lean();
      const id = String(refused!._id);
      expect((await historyRow(id))!.canRerun).toBe(false);
      await rerun(id).expect(409);
    });

    it("lets only the requester re-run it, and hides others' exports", async () => {
      const producers = await failedExport('leads', march, producerToken);
      // Agency scope sees the producer's export, but it is not theirs.
      expect((await historyRow(producers))!.canRerun).toBe(false);
      await rerun(producers).expect(403);
      expect((await historyRow(producers, producerToken))!.canRerun).toBe(true);

      const dataTeams = await failedExport('contacts', march);
      // Own scope cannot see it at all.
      await rerun(dataTeams, producerToken).expect(404);
    });

    it('rejects a malformed export id', async () => {
      await rerun('not-an-id').expect(400);
    });
  });

  describe('row cap and history', () => {
    it('refuses an export over the cap before queuing it, and logs the refusal', async () => {
      process.env.DATA_EXPORT_MAX_ROWS = '1';
      const before = events.sent.length;
      try {
        const res = await post('leads').expect(400);
        expect(res.body).toMatchObject({
          code: 'EXPORT_TOO_LARGE',
          maxRows: 1,
        });
        expect((res.body as { rowCount: number }).rowCount).toBeGreaterThan(1);
      } finally {
        delete process.env.DATA_EXPORT_MAX_ROWS;
      }
      expect(events.sent.length).toBe(before);
    });

    it('records every export with who, what and how many', async () => {
      const res = await request(server())
        .get('/api/v1/data-export/history?pageSize=100')
        .set(authHeader(dataTeamToken))
        .expect(200);
      const body = res.body as DataExportHistoryResponse;
      expect(body.total).toBeGreaterThan(10);

      const refused = body.items.find(
        (item) => item.error === 'EXPORT_TOO_LARGE',
      )!;
      expect(refused).toMatchObject({
        status: 'failed',
        datasetKey: 'leads',
        canDownload: false,
      });

      const windowed = body.items.find(
        (item) =>
          item.datasetKey === 'leads' &&
          item.filters.from === '2026-05-01' &&
          item.status === 'ready',
      )!;
      expect(windowed).toMatchObject({
        format: 'csv',
        datasetLabel: 'Leads',
        createdById: dataTeamId,
        createdByName: 'Dana Data',
        filename: 'test-agency_leads_2026-05-01_2026-05-31.csv',
        canDownload: true,
        truncated: false,
      });
      expect(windowed.rowCount).toBeGreaterThanOrEqual(2);
      expect(windowed.bytes).toBeGreaterThan(0);
      expect(windowed.expiresAt).not.toBeNull();
      expect(windowed.notifiedAt).not.toBeNull();

      expect(body.items.some((item) => item.status === 'queued')).toBe(true);
      expect(body.items.some((item) => item.status === 'expired')).toBe(true);
      expect(body.items.some((item) => item.format === 'xlsx')).toBe(true);
      // Agency scope sees the producer's exports too.
      expect(body.items.some((item) => item.createdById === producerId)).toBe(
        true,
      );
    });

    it('shows a producer only their own exports', async () => {
      const res = await request(server())
        .get('/api/v1/data-export/history?pageSize=100')
        .set(authHeader(producerToken))
        .expect(200);
      const body = res.body as DataExportHistoryResponse;
      expect(body.items.length).toBeGreaterThan(0);
      expect(new Set(body.items.map((item) => item.createdById))).toEqual(
        new Set([producerId]),
      );
    });

    it('paginates', async () => {
      const res = await request(server())
        .get('/api/v1/data-export/history?page=2&pageSize=1')
        .set(authHeader(dataTeamToken))
        .expect(200);
      const body = res.body as DataExportHistoryResponse;
      expect(body.items).toHaveLength(1);
      expect(body.page).toBe(2);
      expect(body.totalPages).toBe(body.total);
    });

    it('rejects a malformed export id', async () => {
      await request(server())
        .get('/api/v1/data-export/exports/not-an-id/url')
        .set(authHeader(dataTeamToken))
        .expect(400);
    });
  });
});
