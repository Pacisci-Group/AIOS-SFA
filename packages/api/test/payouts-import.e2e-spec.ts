import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import {
  ANY_CARRIER,
  PAYOUT_IMPORT_ALREADY_CHARGED,
  PAYOUT_IMPORT_CHARGED_SINCE,
  PAYOUT_IMPORT_DUPLICATE_FILE,
  PAYOUT_IMPORT_NOT_EDITABLE,
  PAYOUT_IMPORT_UNREADABLE_FILE,
  PAYOUT_IMPORT_UNRESOLVED_ROWS,
  type ChargebackImportCommitResponse,
  type ChargebackImportPresignResponse,
  type ChargebackImportRowView,
  type ChargebackImportsResponse,
  type ChargebackImportSummary,
  type ChargebackImportView,
  type ImportPeopleResponse,
  type PayoutActivityView,
  type PayStatementView,
  type PolicyReplacementChain,
  type UpdateImportRowResponse,
  type UpsertPaymentStructureInput,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Chargeback } from '../src/chargebacks/schemas/chargeback.schema';
import { businessDateInstant } from '../src/common/dates/business-dates';
import {
  chargebackCsv,
  chargebackWorkbook,
  reportRows,
} from '../src/common/payouts/__fixtures__/chargeback-workbook';
import { Deal } from '../src/deals/schemas/deal.schema';
import { ChargebackImport } from '../src/payouts/schemas/chargeback-import.schema';
import { PaymentStructure } from '../src/payouts/schemas/payment-structure.schema';
import { PayStatement } from '../src/payouts/schemas/pay-statement.schema';
import { PayoutRun } from '../src/payouts/schemas/payout-run.schema';
import { RoleAssignmentsService } from '../src/permissions/role-assignments.service';
import { Policy } from '../src/policies/schemas/policy.schema';
import { AgencyRole } from '../src/roles/schemas/agency-role.schema';
import { StorageService } from '../src/storage/storage.service';
import { User } from '../src/users/schemas/user.schema';
import { authHeader, login } from './helpers/auth.helper';
import { FakeStorage } from './helpers/fake-storage';
import {
  seedTestData,
  TEST_PASSWORD,
  type TestSeedContext,
} from './helpers/seed-test-data';
import {
  CapturedInngestService,
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';
import { InngestService } from '../src/inngest/inngest.service';

const CHICAGO = 'America/Chicago';
const onDay = (iso: string) => businessDateInstant(iso, CHICAGO);
const noon = (iso: string) => new Date(onDay(iso).getTime() + 12 * 3_600_000);

const MONTH = '2026-03';
const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * PAC-180 — the carrier chargeback report import, end to end.
 *
 * March 2026 in the seeded agency (Chicago). Structure "Producers": Allstate
 * 10%, any other carrier 5%; members P1 (the seeded producer, Test Producer,
 * SOK `SOKP1`), C1 (the seeded CSR, Test Csr) and a producer removed in
 * January (Former Fixture, SOK `SOKOLD`). Two users share the name "Twin
 * Fixture".
 *
 * | policy | sold by | |
 * |---|---|---|
 * | PR-1 | P1, Allstate Auto 3,000 | |
 * | PR-2 | P1, Allstate Home 2,000 | a March app cancellation (2,000) |
 * | PR-3 | C1, Allstate Auto 1,000 | |
 * | PR-4 | P1, Allstate Home 800 | a **February** app cancellation (400) |
 * | PR-5, PR-6, PR-8, PR-9, PR-10 | P1, Allstate | |
 * | PR-7 | C1, Allstate Auto 900 | |
 * | ORPHAN-1 | no sale | |
 *
 * The report (the sample's columns plus a SOK column):
 *
 * | row | SOK | Producer | policy | amount | expected |
 * |---|---|---|---|---|---|
 * | 2 | SOKP1 | Test Producer | PR-1 | 250 | matched → P1 (SOK) |
 * | 3 | | Test Csr | PR-3 | 100 | matched → C1 (name = seller) |
 * | 4 | | Test Producer | PR-7 | 60 | needs a person (P1 named, C1 sold) |
 * | 5 | | Nobody Here | NOPE-1 | 40 | needs a person |
 * | 6 | | Test Producer | PR-2 | 2,000 | duplicate (charged in March) |
 * | 7 | SOKOLD | | ZZ-9 (Progressive) | 300 | matched → Former, no policy |
 * | 8 | | Twin Fixture | ORPHAN-1 | 80 | needs a person (ambiguous, no sale) |
 * | 9 | SOKXXX | | PR-5 | 75.50 | matched → P1 (seller), SOK unknown |
 * | 10 | | Test Producer | PR-4 | 400 | duplicate (charged in February) |
 * | 11 | | Test Producer | PR-1 | 25 | duplicate (row 2 charges PR-1) |
 * | 12 | | Test Producer | PR-6 | -20 | skipped (opposite sign: a reversal) |
 * | 13 | (a total line) | | | 9,999 | left out with a warning |
 */
describe('Payouts — chargeback report import (e2e)', () => {
  let app: INestApplication<App>;
  let seed: TestSeedContext;
  let storage: FakeStorage;
  let ownerToken: string;
  let producerToken: string;
  let managerToken: string;
  let p1: string;
  let c1: string;
  let formerId: string;
  let policyPr1: string;
  let dealPr1: string;
  let chargebacks: Model<Chargeback>;
  let statements: Model<PayStatement>;
  let dealModel: Model<Deal>;
  let importId: string;
  /** An app cancellation chargeback on one of the sold policies. */
  let recordAppChargeback: (
    policyNumber: string,
    amount: number,
    occurredAt: Date,
  ) => Promise<void>;

  const api = () => request(app.getHttpServer());
  const main = () => ({ agencyId: seed.agencyId, branchId: seed.branchId });
  const base = '/api/v1/payouts/imports';

  const report = () =>
    chargebackWorkbook([
      ...reportRows(
        [
          {
            sok: 'SOKP1',
            producer: 'Test Producer',
            policyNumber: 'PR-1',
            prorated: '250.00',
            customer: 'Ann One',
          },
          { producer: 'Test Csr', policyNumber: 'PR-3', prorated: 100 },
          { producer: 'Test Producer', policyNumber: 'PR-7', prorated: 60 },
          { producer: 'Nobody Here', policyNumber: 'NOPE-1', prorated: 40 },
          { producer: 'Test Producer', policyNumber: 'PR-2', prorated: 2000 },
          {
            sok: 'SOKOLD',
            policyNumber: 'ZZ-9',
            carrier: 'Progressive',
            customer: 'Gone Customer',
            prorated: 300,
          },
          { producer: 'Twin Fixture', policyNumber: 'ORPHAN-1', prorated: 80 },
          { sok: 'SOKXXX', policyNumber: 'PR-5', prorated: '75.50' },
          { producer: 'Test Producer', policyNumber: 'PR-4', prorated: 400 },
          { producer: 'Test Producer', policyNumber: 'pr 1', prorated: 25 },
          { producer: 'Test Producer', policyNumber: 'PR-6', prorated: '-20' },
        ],
        { withSok: true },
      ),
      ['', '', '', '', '', '', '', '', '', '', '', '', 9999],
    ]);

  const presign = (filename: string, size: number, token = ownerToken) =>
    api()
      .post(`${base}/presign`)
      .set(authHeader(token))
      .send({ filename, size });

  /**
   * Presign, "PUT" the bytes, create — `upload(bytes).expect(status)` reads
   * like a supertest call and resolves to the create response.
   */
  const upload = (
    bytes: Buffer,
    {
      filename = 'june-chargebacks.xlsx',
      month = MONTH,
      carrier = 'Allstate',
    } = {},
  ) => ({
    expect: async (status: number) => {
      const presigned = await presign(filename, bytes.byteLength).expect(201);
      const { key } = presigned.body as ChargebackImportPresignResponse;
      await storage.putObject(key, bytes, XLSX_TYPE);
      return api()
        .post(base)
        .set(authHeader(ownerToken))
        .send({
          storageKey: key,
          uploadedFilename: filename,
          size: bytes.byteLength,
          carrier,
          month,
        })
        .expect(status);
    },
  });

  const getImport = async (id: string) =>
    (await api().get(`${base}/${id}`).set(authHeader(ownerToken)).expect(200))
      .body as ChargebackImportView;

  const rowOf = (view: ChargebackImportView, rowNumber: number) =>
    view.rows.find((row) => row.rowNumber === rowNumber)!;

  const act = (id: string, rowNumber: number, body: object) =>
    api()
      .patch(`${base}/${id}/rows/${rowNumber}`)
      .set(authHeader(ownerToken))
      .send(body);

  const statementFor = async (userId: string, month = MONTH) => {
    const doc = await statements
      .findOne({ userId: new Types.ObjectId(userId), month })
      .lean();
    if (!doc) return null;
    return (
      await api()
        .get(`/api/v1/payouts/statements/${String(doc._id)}`)
        .set(authHeader(ownerToken))
        .expect(200)
    ).body as PayStatementView;
  };

  beforeAll(async () => {
    storage = new FakeStorage();
    app = await createTestApp({
      overrides: [
        { provide: InngestService, useValue: new CapturedInngestService() },
        { provide: StorageService, useValue: storage.asService() },
      ],
    });
    await dropTestDatabase(app);
    seed = await seedTestData(app);

    const userModel = app.get<Model<User>>(getModelToken(User.name));
    const roleModel = app.get<Model<AgencyRole>>(
      getModelToken(AgencyRole.name),
    );
    const policyModel = app.get<Model<Policy>>(getModelToken(Policy.name));
    dealModel = app.get<Model<Deal>>(getModelToken(Deal.name));
    chargebacks = app.get<Model<Chargeback>>(getModelToken(Chargeback.name));
    statements = app.get<Model<PayStatement>>(getModelToken(PayStatement.name));
    const runs = app.get<Model<PayoutRun>>(getModelToken(PayoutRun.name));
    const imports = app.get<Model<ChargebackImport>>(
      getModelToken(ChargebackImport.name),
    );
    const structures = app.get<Model<PaymentStructure>>(
      getModelToken(PaymentStructure.name),
    );
    // `dropTestDatabase` drops the indexes the app built at boot: the run
    // claim, one statement per person, and one import per file ride on them.
    await runs.syncIndexes();
    await statements.syncIndexes();
    await imports.syncIndexes();
    const roleAssignments = app.get(RoleAssignmentsService);

    const producer = await userModel
      .findOne({ email: seed.producerEmail })
      .select('+passwordHash');
    const owner = await userModel.findOne({ email: seed.ownerEmail });
    p1 = String(producer!._id);
    c1 = seed.csrUserId;
    await userModel.updateOne(
      { _id: producer!._id },
      { $set: { allstateBindId: 'SOKP1' } },
    );
    const agencyId = new Types.ObjectId(seed.agencyId);
    const roles = await roleModel.find({ agencyId }).lean();
    const roleId = (slug: string) =>
      roles.find((role) => role.slug === slug)!._id;
    const seedActor = { userId: String(owner!._id), isPlatformAdmin: true };
    const person = async (
      email: string,
      slug: string,
      extra: Record<string, unknown> = {},
    ) => {
      const user = await userModel.create({
        agencyId,
        branchId: new Types.ObjectId(seed.branchId),
        email,
        passwordHash: (producer as unknown as { passwordHash: string })
          .passwordHash,
        firstName: email.split('@')[0],
        lastName: 'Fixture',
        isActive: true,
        ...extra,
      });
      await roleAssignments.setUserRoles(seedActor, agencyId, user._id, [
        roleId(slug),
      ]);
      return String(user._id);
    };
    const managerEmail = 'import-manager@sfa.local';
    await person(managerEmail, 'branch_manager');
    formerId = await person('import-former@sfa.local', 'producer', {
      firstName: 'Former',
      allstateBindId: 'SOKOLD',
      isActive: false,
      deactivatedAt: new Date('2026-01-15T12:00:00Z'),
    });
    await person('twin-a@sfa.local', 'producer', { firstName: 'Twin' });
    await person('twin-b@sfa.local', 'producer', { firstName: 'Twin' });

    ownerToken = (await login(app, seed.ownerEmail, TEST_PASSWORD)).accessToken;
    producerToken = (await login(app, seed.producerEmail, TEST_PASSWORD))
      .accessToken;
    managerToken = (await login(app, managerEmail, TEST_PASSWORD)).accessToken;

    const sell = async (
      producerId: string,
      policyNumber: string,
      policyType: string,
      premium: number,
    ) => {
      const deal = await dealModel.create({
        ...main(),
        producerId: new Types.ObjectId(producerId),
        clientName: `Client ${policyNumber}`,
        householdId: new Types.ObjectId(),
        dealType: 'Other',
        policyTypes: [policyType],
        premium,
        itemCount: 1,
        premiumSource: 'rollup',
        soldDate: noon('2026-03-10'),
        status: 'Sold',
      });
      const [policy] = await policyModel.create([
        {
          ...main(),
          dealId: deal._id,
          householdId: deal.householdId,
          policyNumber,
          policyNumberKey: policyNumber
            .replace(/[^A-Z0-9]/gi, '')
            .toUpperCase(),
          policyStatus: 'Active',
          policyType,
          carrier: 'Allstate',
          premium,
          items: 1,
        },
      ]);
      return { deal, policy };
    };
    const pr1 = await sell(p1, 'PR-1', 'Auto', 3000);
    const pr2 = await sell(p1, 'PR-2', 'Home', 2000);
    await sell(c1, 'PR-3', 'Auto', 1000);
    const pr4 = await sell(p1, 'PR-4', 'Home', 800);
    await sell(p1, 'PR-5', 'Auto', 600);
    await sell(p1, 'PR-6', 'Auto', 700);
    await sell(c1, 'PR-7', 'Auto', 900);
    const sold = new Map(
      await Promise.all(
        ['PR-8', 'PR-9', 'PR-10'].map(
          async (number) =>
            [number, await sell(p1, number, 'Auto', 500)] as const,
        ),
      ),
    );
    sold.set('PR-1', pr1);
    policyPr1 = String(pr1.policy._id);
    dealPr1 = String(pr1.deal._id);
    await policyModel.create({
      ...main(),
      householdId: new Types.ObjectId(),
      policyNumber: 'ORPHAN-1',
      policyNumberKey: 'ORPHAN1',
      policyStatus: 'Active',
      policyType: 'Home',
      carrier: 'Allstate',
      premium: 900,
      items: 1,
    });

    const appRow = (
      sold: typeof pr1,
      amount: number,
      occurredAt: Date,
    ): Record<string, unknown> => ({
      ...main(),
      policyId: sold.policy._id,
      policyNumber: sold.policy.policyNumber,
      policyType: sold.policy.policyType,
      dealId: sold.deal._id,
      householdId: sold.deal.householdId,
      producerId: producer!._id,
      producerName: 'Test Producer',
      reason: 'cancellation',
      source: 'app',
      amount,
      soldAdjustment: 0,
      withinClawbackWindow: false,
      occurredAt,
      soldDate: sold.deal.soldDate,
    });
    await chargebacks.create(appRow(pr2, 2000, noon('2026-03-20')));
    await chargebacks.create(appRow(pr4, 400, noon('2026-02-20')));
    recordAppChargeback = async (policyNumber, amount, occurredAt) => {
      await chargebacks.create(
        appRow(sold.get(policyNumber)!, amount, occurredAt),
      );
    };

    const structure: UpsertPaymentStructureInput = {
      name: 'Producers',
      rules: [
        { carrier: 'Allstate', ratePercent: 10 },
        { carrier: ANY_CARRIER, ratePercent: 5 },
      ],
      leadSourceRules: [],
      hatTrick: { enabled: false, dealsPerDay: 3, bonusAmount: 50 },
      individualTiers: [],
      tiersStackable: false,
      teamBonusEligible: false,
      memberIds: [p1, c1],
    };
    const created = await api()
      .post('/api/v1/payouts/structures')
      .set(authHeader(ownerToken))
      .send(structure)
      .expect(201);
    await structures.updateOne(
      { _id: new Types.ObjectId((created.body as { id: string }).id) },
      { $push: { memberIds: new Types.ObjectId(formerId) } },
    );

    await api()
      .post('/api/v1/payouts/runs')
      .set(authHeader(ownerToken))
      .send({ month: MONTH })
      .expect(200);
  });

  afterAll(async () => {
    if (app) {
      await dropTestDatabase(app);
      await closeTestApp(app);
    }
  });

  describe('POST /payouts/imports/presign', () => {
    it('signs an .xlsx or a .csv upload under the agency', async () => {
      const xlsx = (await presign('june.xlsx', 1000).expect(201))
        .body as ChargebackImportPresignResponse;
      expect(xlsx.key).toMatch(
        new RegExp(`^agencies/${seed.agencyId}/payout-chargebacks/`),
      );
      expect(xlsx.requiredHeaders['Content-Type']).toBe(XLSX_TYPE);
      const csv = (await presign('june.csv', 1000).expect(201))
        .body as ChargebackImportPresignResponse;
      expect(csv.requiredHeaders['Content-Type']).toBe('text/csv');
    });

    it('refuses another kind of file, and anyone but the admin', async () => {
      await presign('june.pdf', 1000).expect(400);
      await presign('june.xlsx', 1000, producerToken).expect(403);
      await presign('june.xlsx', 1000, managerToken).expect(403);
    });
  });

  describe('POST /payouts/imports', () => {
    it('refuses a key from another agency, a missing upload and a size mismatch', async () => {
      const send = (storageKey: string, size = 10) =>
        api().post(base).set(authHeader(ownerToken)).send({
          storageKey,
          uploadedFilename: 'x.xlsx',
          size,
          carrier: 'Allstate',
          month: MONTH,
        });
      await send(
        `agencies/${seed.otherAgencyId}/payout-chargebacks/2026/x.xlsx`,
      ).expect(400);
      await send(
        `agencies/${seed.agencyId}/payout-chargebacks/2026/missing.xlsx`,
      ).expect(400);

      const key = `agencies/${seed.agencyId}/payout-chargebacks/2026/size.xlsx`;
      await storage.putObject(key, report(), XLSX_TYPE);
      await send(key, 10).expect(400);
      expect(storage.objects.has(key)).toBe(false);
    });

    it('refuses a month that has not started', async () => {
      await upload(report(), { month: '2099-01' }).expect(400);
    });

    it('names a missing required column (422)', async () => {
      const res = await upload(
        chargebackWorkbook([
          ['Customer', 'Policy Number', 'Premium'],
          ['Pat', 'PR-1', 100],
        ]),
      ).expect(422);
      expect(res.body).toMatchObject({
        code: PAYOUT_IMPORT_UNREADABLE_FILE,
        reason: 'missing_columns',
        message:
          'The report is missing a column: Prorated Amount (or Chargeback Amount).',
      });
    });

    it('refuses a file named .xlsx that is not one', async () => {
      const res = await upload(Buffer.from('Policy Number,Amount\nP1,10\n'), {
        filename: 'not-really.xlsx',
      }).expect(422);
      expect(res.body).toMatchObject({ reason: 'unreadable' });
    });

    it('reads and matches every line into a preview', async () => {
      const res = await upload(report()).expect(201);
      const view = res.body as ChargebackImportView;
      importId = view.id;
      expect(view).toMatchObject({
        status: 'preview',
        month: MONTH,
        carrier: 'Allstate',
        filename: 'june-chargebacks.xlsx',
        format: 'xlsx',
        headerRowNumber: 1,
        counts: {
          rows: 11,
          matched: 4,
          assigned: 0,
          unmatched: 3,
          skipped: 1,
          duplicate: 3,
          toCharge: 4,
          amountToCharge: 725.5,
        },
      });
      expect(view.warnings).toEqual([
        '1 line has the opposite sign to the rest (row 12) — read as reversals and left out. Charge one only if it really is a chargeback.',
        '1 line with an amount but no policy number was left out (row 13) — a total line?',
      ]);
      expect(view.columns).toEqual(
        expect.arrayContaining([
          { field: 'amount', header: 'Prorated Amount' },
          { field: 'bindId', header: 'SOK' },
        ]),
      );

      const summary = (row: ChargebackImportRowView) => ({
        resolution: row.resolution,
        chargedTo: row.chargedTo?.userId ?? null,
        notes: row.notes,
      });
      expect(summary(rowOf(view, 2))).toEqual({
        resolution: 'matched',
        chargedTo: p1,
        notes: [],
      });
      expect(rowOf(view, 2)).toMatchObject({
        amount: 250,
        carrier: 'Allstate',
        policy: { id: policyPr1, policyNumber: 'PR-1' },
      });
      expect(summary(rowOf(view, 3))).toEqual({
        resolution: 'matched',
        chargedTo: c1,
        notes: [],
      });
      expect(summary(rowOf(view, 4))).toEqual({
        resolution: 'unmatched',
        chargedTo: null,
        notes: ['name_seller_differ'],
      });
      expect(rowOf(view, 4).candidates).toEqual([
        expect.objectContaining({ userId: p1, via: 'name' }),
        expect.objectContaining({ userId: c1, via: 'policy' }),
      ]);
      expect(summary(rowOf(view, 5))).toEqual({
        resolution: 'unmatched',
        chargedTo: null,
        notes: ['name_unknown', 'policy_not_found'],
      });
      // Already charged back this month — the original is named.
      expect(summary(rowOf(view, 6))).toEqual({
        resolution: 'duplicate',
        chargedTo: p1,
        notes: ['already_charged'],
      });
      expect(rowOf(view, 6).existingChargeback).toMatchObject({
        reason: 'cancellation',
        source: 'app',
        amount: 2000,
        statementMonth: null,
        producerName: 'Test Producer',
      });
      expect(summary(rowOf(view, 7))).toEqual({
        resolution: 'matched',
        chargedTo: formerId,
        notes: ['policy_not_found'],
      });
      expect(rowOf(view, 7)).toMatchObject({
        carrier: 'Progressive',
        policy: null,
        chargedTo: { status: 'deactivated', name: 'Former Fixture' },
      });
      expect(summary(rowOf(view, 8))).toEqual({
        resolution: 'unmatched',
        chargedTo: null,
        notes: ['name_ambiguous', 'policy_no_sale'],
      });
      expect(summary(rowOf(view, 9))).toEqual({
        resolution: 'matched',
        chargedTo: p1,
        notes: ['sok_unknown', 'seller_used'],
      });
      expect(rowOf(view, 9).amount).toBe(75.5);

      // Charged back in February: still a duplicate — a policy is charged once.
      expect(summary(rowOf(view, 10))).toEqual({
        resolution: 'duplicate',
        chargedTo: p1,
        notes: ['already_charged'],
      });
      expect(rowOf(view, 10).existingChargeback).toMatchObject({
        amount: 400,
        occurredAt: noon('2026-02-20').toISOString(),
      });
      // Row 2 charges PR-1 ("pr 1" is the same number).
      expect(rowOf(view, 11)).toMatchObject({
        resolution: 'duplicate',
        notes: ['repeated_in_file'],
        repeatOfRow: 2,
        existingChargeback: null,
      });
      // A reversal: the rest of the report is positive.
      expect(summary(rowOf(view, 12))).toEqual({
        resolution: 'skipped',
        chargedTo: p1,
        notes: ['opposite_sign'],
      });
      expect(rowOf(view, 12).amount).toBe(20);
    });

    it('refuses the same file again, naming the import that has it', async () => {
      const res = await upload(report()).expect(409);
      expect(res.body).toMatchObject({
        code: PAYOUT_IMPORT_DUPLICATE_FILE,
        importId,
      });
    });
  });

  describe('reading', () => {
    it('lists the month’s imports and the people a line may be charged to', async () => {
      const list = (
        await api()
          .get(`${base}?month=${MONTH}`)
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as ChargebackImportsResponse;
      expect(list.imports.map((item) => item.id)).toEqual([importId]);
      expect(list.imports[0]).toMatchObject({
        createdByName: 'Test Owner',
        counts: { rows: 11, unmatched: 3 },
      });

      const people = (
        await api()
          .get(`${base}/people`)
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as ImportPeopleResponse;
      expect(people.people).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: formerId, status: 'deactivated' }),
          expect.objectContaining({ id: p1, allstateBindId: 'SOKP1' }),
        ]),
      );
    });

    it('is the admin’s alone', async () => {
      await api()
        .get(`${base}/${importId}`)
        .set(authHeader(managerToken))
        .expect(403);
      await api()
        .get(`${base}?month=${MONTH}`)
        .set(authHeader(producerToken))
        .expect(403);
    });
  });

  describe('resolving lines', () => {
    it('refuses a commit while a line needs a person', async () => {
      const res = await api()
        .post(`${base}/${importId}/commit`)
        .set(authHeader(ownerToken))
        .expect(400);
      expect(res.body).toMatchObject({
        code: PAYOUT_IMPORT_UNRESOLVED_ROWS,
        unresolved: 3,
      });
    });

    it('assigns, skips and resets', async () => {
      // Row 4: the file named P1, the app's sale is C1's — charge C1.
      const assigned = (
        await act(importId, 4, { action: 'assign', userId: c1 }).expect(200)
      ).body as UpdateImportRowResponse;
      expect(assigned.row).toMatchObject({
        resolution: 'assigned',
        chargedTo: { userId: c1 },
      });
      expect(assigned.counts).toMatchObject({ unmatched: 2, assigned: 1 });

      await act(importId, 5, { action: 'skip' }).expect(200);

      // Row 8: assign, reset back to needing a person, assign again.
      await act(importId, 8, { action: 'assign', userId: p1 }).expect(200);
      const reset = (await act(importId, 8, { action: 'reset' }).expect(200))
        .body as UpdateImportRowResponse;
      expect(reset.row).toMatchObject({
        resolution: 'unmatched',
        chargedTo: null,
      });
      const again = (
        await act(importId, 8, { action: 'assign', userId: p1 }).expect(200)
      ).body as UpdateImportRowResponse;
      expect(again.counts).toMatchObject({
        rows: 11,
        unmatched: 0,
        assigned: 2,
        skipped: 2,
        duplicate: 3,
      });
    });

    it('never lets a duplicate be charged', async () => {
      for (const body of [
        { action: 'assign', userId: p1 },
        { action: 'skip' },
        { action: 'reset' },
      ]) {
        const res = await act(importId, 6, body).expect(400);
        expect(res.body).toMatchObject({ code: PAYOUT_IMPORT_ALREADY_CHARGED });
      }
      // There is no "include" any more.
      await act(importId, 6, { action: 'include' }).expect(400);
      await act(importId, 11, { action: 'assign', userId: p1 }).expect(400);
    });

    it('refuses what makes no sense', async () => {
      await act(importId, 2, {
        action: 'assign',
        userId: new Types.ObjectId().toHexString(),
      }).expect(400);
      await act(importId, 99, { action: 'skip' }).expect(404);
      await act(importId, 2, { action: 'nope' }).expect(400);
    });
  });

  describe('POST /payouts/imports/:id/commit', () => {
    let before: PayStatementView;
    let csrSentId: string;
    let result: ChargebackImportCommitResponse['result'];

    beforeAll(async () => {
      before = (await statementFor(p1))!;
      // C1's statement has gone out: a commit must leave it alone.
      const csr = await statements.findOneAndUpdate(
        { userId: new Types.ObjectId(c1), month: MONTH },
        { $set: { status: 'sent' } },
        { new: true },
      );
      csrSentId = String(csr!._id);
      const res = await api()
        .post(`${base}/${importId}/commit`)
        .set(authHeader(ownerToken))
        .expect(200);
      const body = res.body as ChargebackImportCommitResponse;
      result = body.result;
      expect(body.import.status).toBe('committed');
    });

    it('writes one ledger row per charged line', async () => {
      expect(result).toMatchObject({
        written: 6,
        amount: 865.5,
        recalculation: 'recalculated',
      });
      const rows = await chargebacks
        .find({ importId: new Types.ObjectId(importId) })
        .sort({ amount: 1 })
        .lean();
      expect(rows.map((row) => row.amount)).toEqual([
        60, 75.5, 80, 100, 250, 300,
      ]);
      for (const row of rows) {
        expect(row).toMatchObject({
          reason: 'carrier_statement',
          source: 'carrier_statement',
          statementMonth: MONTH,
          soldAdjustment: 0,
          withinClawbackWindow: false,
          agencyId: seed.agencyId,
        });
        expect(row.branchId).toBeTruthy();
      }
      const gone = rows.find((row) => row.amount === 300)!;
      expect(gone).toMatchObject({
        policyId: null,
        policyNumber: 'ZZ-9',
        carrier: 'Progressive',
        customerName: 'Gone Customer',
        producerName: 'Former Fixture',
      });
      expect(String(gone.producerId)).toBe(formerId);
      const pr1 = rows.find((row) => row.amount === 250)!;
      expect(String(pr1.policyId)).toBe(policyPr1);
      expect(String(pr1.dealId)).toBe(dealPr1);
      expect(pr1.occurredAt.toISOString()).toBe(
        onDay('2026-03-01').toISOString(),
      );

      // The sale's sold figure is untouched.
      const deal = await dealModel.findById(dealPr1).lean();
      expect(deal?.chargebackAdjustment ?? 0).toBe(0);

      // Every committed line names its ledger row.
      const view = await getImport(importId);
      expect(rowOf(view, 2).chargebackId).toBe(String(pr1._id));
      for (const skippedOrDuplicate of [5, 6, 10, 11, 12]) {
        expect(rowOf(view, skippedOrDuplicate).chargebackId).toBeNull();
      }
    });

    it('recalculates the draft: the lines are under its chargebacks and the net is lower', async () => {
      const after = (await statementFor(p1))!;
      const imported = after.chargebacks.filter(
        (row) => row.source === 'carrier_statement',
      );
      expect(imported.map((row) => row.amount).sort((a, b) => a - b)).toEqual([
        75.5, 80, 250,
      ]);
      expect(imported.find((row) => row.amount === 250)).toMatchObject({
        reason: 'carrier_statement',
        carrier: 'Allstate',
        customerName: 'Client PR-1',
      });
      // 405.50 more premium charged back at 10%.
      expect(after.totals.chargebackTotal).toBe(
        before.totals.chargebackTotal + 405.5,
      );
      expect(after.totals.netCommission).toBeCloseTo(
        before.totals.netCommission - 40.55,
        2,
      );
    });

    it('leaves a sent statement alone and lists it', async () => {
      expect(result.untouched).toEqual([
        { statementId: csrSentId, userName: 'Test Csr', status: 'sent' },
      ]);
      const csr = await statements.findById(csrSentId).lean();
      expect(
        (csr!.chargebacks ?? []).some(
          (row) => row.source === 'carrier_statement',
        ),
      ).toBe(false);
    });

    it('drafts a statement for someone who has left, from the chargeback alone', async () => {
      const former = await statementFor(formerId);
      expect(former?.chargebacks).toEqual([
        expect.objectContaining({
          amount: 300,
          policyId: null,
          carrier: 'Progressive',
          customerName: 'Gone Customer',
          ratePercent: 5,
        }),
      ]);
    });

    it('shows the lines in the person’s activity', async () => {
      const activity = (
        await api()
          .get(`/api/v1/payouts/activity?month=${MONTH}&userId=${p1}`)
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as PayoutActivityView;
      expect(
        activity.chargebacks.filter(
          (row) => row.source === 'carrier_statement',
        ),
      ).toHaveLength(3);
    });

    it('is final', async () => {
      const again = await api()
        .post(`${base}/${importId}/commit`)
        .set(authHeader(ownerToken))
        .expect(409);
      expect(again.body).toMatchObject({ code: PAYOUT_IMPORT_NOT_EDITABLE });
      await act(importId, 5, { action: 'reset' }).expect(409);
      await api()
        .delete(`${base}/${importId}`)
        .set(authHeader(ownerToken))
        .expect(409);
      const stored = (await getImport(importId)).result;
      expect(stored).toMatchObject({
        written: 6,
        recalculation: 'recalculated',
      });
    });

    it('keeps the policy history to the app’s own chargebacks', async () => {
      // PR-1 carries the report's $250; the app later records its own.
      await recordAppChargeback('PR-1', 300, noon('2026-03-30'));
      const chain = (
        await api()
          .get(`/api/v1/policies/${policyPr1}/history`)
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as PolicyReplacementChain;
      expect(chain.totalChargeback).toBe(300);
    });
  });

  describe('a line counts in the import’s month, whatever its date', () => {
    it('charges April for a line cancelled in March, and says April is not calculated', async () => {
      const created = (
        await upload(
          chargebackCsv([
            ['Policy Number', 'Chargeback Amount', 'Producer', 'Cancel Date'],
            ['PR-8', '12.34', 'Test Producer', '3/28/2026'],
            // Charged in March with no policy in the app: found by number.
            ['zz 9', '5', '', ''],
          ]),
          { filename: 'april.csv', month: '2026-04' },
        ).expect(201)
      ).body as ChargebackImportView;
      expect(created.format).toBe('csv');
      expect(rowOf(created, 2)).toMatchObject({
        resolution: 'matched',
        occurredDay: '2026-03-28',
      });
      expect(rowOf(created, 3).notes).toContain('already_charged');
      expect(rowOf(created, 3)).toMatchObject({
        resolution: 'duplicate',
        existingChargeback: {
          source: 'carrier_statement',
          statementMonth: MONTH,
          amount: 300,
        },
      });
      const res = await api()
        .post(`${base}/${created.id}/commit`)
        .set(authHeader(ownerToken))
        .expect(200);
      expect((res.body as ChargebackImportCommitResponse).result).toMatchObject(
        {
          written: 1,
          recalculation: 'no_run',
          runId: null,
        },
      );

      const activity = async (month: string) =>
        (
          (
            await api()
              .get(`/api/v1/payouts/activity?month=${month}&userId=${p1}`)
              .set(authHeader(ownerToken))
              .expect(200)
          ).body as PayoutActivityView
        ).chargebacks.map((row) => row.amount);
      expect(await activity('2026-03')).not.toContain(12.34);
      expect(await activity('2026-04')).toContain(12.34);
    });
  });

  describe('the ledger moving under a preview', () => {
    const csv = (policyNumber: string, amount: string) =>
      chargebackCsv([
        ['Policy Number', 'Prorated Amount', 'Producer'],
        [policyNumber, amount, 'Test Producer'],
      ]);

    it('refuses a commit whose policies were charged back since, and marks those lines', async () => {
      const created = (
        await upload(csv('PR-9', '30'), {
          filename: 'may.csv',
          month: '2026-05',
        }).expect(201)
      ).body as ChargebackImportView;
      expect(rowOf(created, 2).resolution).toBe('matched');

      // The app records the cancellation while the preview is open.
      await recordAppChargeback('PR-9', 500, noon('2026-05-02'));

      const refused = await api()
        .post(`${base}/${created.id}/commit`)
        .set(authHeader(ownerToken))
        .expect(409);
      expect(refused.body).toMatchObject({
        code: PAYOUT_IMPORT_CHARGED_SINCE,
        rowNumbers: [2],
      });
      const marked = await getImport(created.id);
      expect(marked.status).toBe('preview');
      expect(rowOf(marked, 2)).toMatchObject({
        resolution: 'duplicate',
        notes: ['already_charged'],
        existingChargeback: { reason: 'cancellation', amount: 500 },
      });

      // Committed again, it charges nothing twice.
      const res = await api()
        .post(`${base}/${created.id}/commit`)
        .set(authHeader(ownerToken))
        .expect(200);
      expect((res.body as ChargebackImportCommitResponse).result).toMatchObject(
        { written: 0, recalculation: 'no_run' },
      );
      expect(
        await chargebacks.countDocuments({
          policyNumber: 'PR-9',
          source: 'carrier_statement',
        }),
      ).toBe(0);
    });

    it('charges a policy once when two reports naming it are committed at once', async () => {
      const first = (
        await upload(csv('PR-10', '11'), {
          filename: 'may-a.csv',
          month: '2026-05',
        }).expect(201)
      ).body as ChargebackImportView;
      const second = (
        await upload(csv('PR-10', '12'), {
          filename: 'may-b.csv',
          month: '2026-05',
        }).expect(201)
      ).body as ChargebackImportView;
      expect(rowOf(first, 2).resolution).toBe('matched');
      expect(rowOf(second, 2).resolution).toBe('matched');

      const commits = await Promise.all(
        [first, second].map((item) =>
          api().post(`${base}/${item.id}/commit`).set(authHeader(ownerToken)),
        ),
      );
      expect(commits.map((res) => res.status).sort()).toEqual([200, 409]);
      expect(commits.find((res) => res.status === 409)?.body).toMatchObject({
        code: PAYOUT_IMPORT_CHARGED_SINCE,
      });
      expect(
        await chargebacks.countDocuments({
          policyNumber: 'PR-10',
          source: 'carrier_statement',
        }),
      ).toBe(1);
    });
  });

  describe('DELETE /payouts/imports/:id', () => {
    it('discards a preview and frees the file to be uploaded again', async () => {
      const bytes = chargebackCsv(
        reportRows([
          { producer: 'Test Producer', policyNumber: 'PR-3', prorated: 5 },
        ]),
      );
      const first = (await upload(bytes, { filename: 'again.csv' }).expect(201))
        .body as ChargebackImportView;
      await upload(bytes, { filename: 'again.csv' }).expect(409);

      const discarded = (
        await api()
          .delete(`${base}/${first.id}`)
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as ChargebackImportSummary;
      expect(discarded.status).toBe('discarded');
      await act(first.id, 2, { action: 'skip' }).expect(409);

      await upload(bytes, { filename: 'again.csv' }).expect(201);
    });
  });
});
