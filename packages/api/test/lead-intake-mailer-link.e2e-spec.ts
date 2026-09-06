import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { MAILER_LEAD_SOURCE_CODE, mailerControlNumberKeys } from '@sfa/shared';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Lead } from '../src/leads/schemas/lead.schema';
import { Mailer } from '../src/mailers/schemas/mailer.schema';
import { authHeader, login } from './helpers/auth.helper';
import {
  TEST_PASSWORD,
  TestSeedContext,
  seedTestData,
} from './helpers/seed-test-data';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';

const CAMPAIGN_ID = '6a86ef5140258c85a093cd01';

/**
 * Attribution write path 2 (PAC-71): a control number typed into an intake, as
 * opposed to the drawer resolving one itself.
 *
 * The callers that can send `quoteControlNumber` are the create-lead API, the
 * public form and the share link. This suite drives the first; all three go
 * through the same `ResolveLeadStep`, so what is asserted here is the pipeline,
 * not the route.
 *
 * ⚠ **There is no New Lead form field for this and never has been** — the web
 * form only *displays* a control number, and the drawer is the entry point a
 * producer actually uses. Adding the field is a follow-up. This path exists
 * because the API accepts the value regardless, and a lead carrying an
 * unnormalized string was the join that silently missed.
 *
 * ⚠ e2e suites share one database — never run two at once.
 */
describe('Lead intake → mailer link (e2e)', () => {
  let app: INestApplication<App>;
  let seed: TestSeedContext;
  let mailerModel: Model<Mailer>;
  let leadModel: Model<Lead>;
  let producerToken: string;

  /** A mailer visible to the seeded agency, in the shape the importer writes. */
  async function insertMailer(
    long: string,
    short: string,
    visibleAgencyIds: string[] | null,
  ) {
    return mailerModel.create({
      campaignId: CAMPAIGN_ID,
      visibleAgencyIds,
      carrierAgencyId: 'A0B9049',
      controlNumber: long,
      newControlNumber: short,
      controlNumberKeys: mailerControlNumberKeys(long, short),
      firstName: 'Rosa',
      lastName: 'Delgado',
      fullName: 'Rosa Delgado',
      source: { system: 'spreadsheet' },
    });
  }

  /**
   * `POST /leads` with the minimum the authenticated DTO accepts.
   *
   * ⚠ Each case passes its own street and a **distinct contact**. Signal 3
   * (address + zip) and the contact matcher would otherwise merge these leads
   * into one and every assertion would be about the first one.
   */
  let caseNumber = 0;
  function createLead(body: Record<string, unknown>) {
    caseNumber += 1;
    return request(app.getHttpServer())
      .post('/api/v1/leads')
      .set(authHeader(producerToken))
      .send({
        primaryContact: {
          firstName: 'Rosa',
          lastName: `Delgado${caseNumber}`,
          dateOfBirth: '1985-04-12',
          phone: '9185550100',
          email: `rosa${caseNumber}@example.com`,
        },
        leadSourceCode: MAILER_LEAD_SOURCE_CODE,
        ...body,
      });
  }

  beforeAll(async () => {
    app = await createTestApp();
    // ⚠ Drop BEFORE seeding. Suites share one database and jest orders them by
    // previous run time, so "the suite before me cleaned up" is an assumption
    // that breaks the moment a new suite is added. Same pattern as
    // `carrier-appointments.e2e-spec.ts`.
    await dropTestDatabase(app);
    seed = await seedTestData(app);
    mailerModel = app.get<Model<Mailer>>(getModelToken(Mailer.name));
    leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));
    // The unique `mailer.mailerId` index is load-bearing here, and the drop
    // above removed it — `autoIndex` ran during `app.init()` and will not rerun.
    await leadModel.syncIndexes();

    producerToken = (await login(app, seed.producerEmail, TEST_PASSWORD))
      .accessToken;
  });

  afterAll(async () => {
    await dropTestDatabase(app);
    await closeTestApp(app);
  });

  it('links a typed control number to its mailer as control_number', async () => {
    const long = '#1a1a1a1a-2b2b-3c3c-4d4d-5e5e5e5e5e5e';
    const mailer = await insertMailer(long, '5e5e5e5e5e5e', [seed.agencyId]);

    const res = await createLead({
      quoteControlNumber: long,
      address: {
        street: '1 Linked Ln',
        city: 'Tulsa',
        state: 'OK',
        zip: '74133',
      },
    }).expect(201);

    const lead = await leadModel
      .findById((res.body as { id: string }).id)
      .lean();

    expect(lead!.mailer?.mailerId?.toString()).toBe(mailer._id.toString());
    expect(lead!.mailer?.campaignId).toBe(CAMPAIGN_ID);
    // Never `drawer`: nobody looked this mailer up, the server resolved a string.
    expect(lead!.mailer?.matchedBy).toBe('control_number');
    expect(lead!.mailer?.linkedBy).toBeTruthy();
  });

  it('resolves the short printed form to the same mailer', async () => {
    // The two forms are different strings. Keying on the raw value — which is
    // what this replaced — matched neither reliably.
    const long = '#2a2a2a2a-3b3b-4c4c-5d5d-6e6e6e6e6e6e';
    const mailer = await insertMailer(long, '6e6e6e6e6e6e', [seed.agencyId]);

    const res = await createLead({
      quoteControlNumber: '6E6E-6E6E-6E6E',
      address: {
        street: '2 Short Form St',
        city: 'Tulsa',
        state: 'OK',
        zip: '74133',
      },
    }).expect(201);

    const lead = await leadModel
      .findById((res.body as { id: string }).id)
      .lean();
    expect(lead!.mailer?.mailerId?.toString()).toBe(mailer._id.toString());
  });

  it('stores the key alone when no mailer answers to the number', async () => {
    // The "prospect called before the operator imported the file" case. The
    // campaign commit's reconcile step walks exactly these leads, which is why
    // the key is worth storing without a mailer.
    const res = await createLead({
      quoteControlNumber: '#deadbeef-0000-1111-2222-333344445555',
      address: {
        street: '3 Pending Pl',
        city: 'Tulsa',
        state: 'OK',
        zip: '74133',
      },
    }).expect(201);

    const lead = await leadModel
      .findById((res.body as { id: string }).id)
      .lean();

    expect(lead!.mailer?.mailerId).toBeNull();
    expect(lead!.mailer?.controlNumberKey).toBe(
      'DEADBEEF00001111222233334444 5555'.replace(/\s/g, ''),
    );
    // Nothing was matched, so nothing claims it was.
    expect(lead!.mailer?.matchedBy).toBeUndefined();
  });

  it('stores nothing when the input normalizes to nothing', async () => {
    const res = await createLead({
      quoteControlNumber: '---',
      address: {
        street: '4 Nonsense Nook',
        city: 'Tulsa',
        state: 'OK',
        zip: '74133',
      },
    }).expect(201);

    const lead = await leadModel
      .findById((res.body as { id: string }).id)
      .lean();
    expect(lead!.mailer).toBeUndefined();
  });

  it('creates the lead key-only when another agency owns the mailer', async () => {
    // ⚠ NOT a 409. The drawer 409s because the producer asked for *that mailer*;
    // here the mailer is a detail on a lead that exists regardless, and failing
    // the whole intake over it would lose a real enquiry.
    const long = '#3a3a3a3a-4b4b-5c5c-6d6d-7e7e7e7e7e7e';
    const mailer = await insertMailer(long, '7e7e7e7e7e7e', null);
    await leadModel.create({
      agencyId: seed.otherAgencyId,
      branchId: seed.branchId,
      firstName: 'Owned',
      lastName: 'Elsewhere',
      mailer: {
        mailerId: mailer._id,
        campaignId: CAMPAIGN_ID,
        controlNumberKey: mailerControlNumberKeys(long, '7e7e7e7e7e7e')[0],
        matchedBy: 'drawer',
        linkedBy: null,
      },
    });

    const res = await createLead({
      quoteControlNumber: long,
      address: {
        street: '5 Contested Ct',
        city: 'Tulsa',
        state: 'OK',
        zip: '74133',
      },
    }).expect(201);

    const lead = await leadModel
      .findById((res.body as { id: string }).id)
      .lean();

    expect(lead!.mailer?.mailerId).toBeNull();
    expect(lead!.mailer?.controlNumberKey).toBe(
      mailerControlNumberKeys(long, '7e7e7e7e7e7e')[0],
    );
    // And the platform-wide rule still holds: exactly one lead links it.
    expect(
      await leadModel.countDocuments({ 'mailer.mailerId': mailer._id }),
    ).toBe(1);
  });

  it('does not link a mailer this agency cannot see', async () => {
    const long = '#4a4a4a4a-5b5b-6c6c-7d7d-8e8e8e8e8e8e';
    await insertMailer(long, '8e8e8e8e8e8e', [seed.otherAgencyId]);

    const res = await createLead({
      quoteControlNumber: long,
      address: {
        street: '6 Invisible Ave',
        city: 'Tulsa',
        state: 'OK',
        zip: '74133',
      },
    }).expect(201);

    const lead = await leadModel
      .findById((res.body as { id: string }).id)
      .lean();
    expect(lead!.mailer?.mailerId).toBeNull();
  });

  it('dedupes a second submission of the same control number onto one lead', async () => {
    // Signal 2, now keyed on the resolved mailer rather than on string equality
    // — so the two printed forms and a re-punctuated one all land on one lead.
    const long = '#5a5a5a5a-6b6b-7c7c-8d8d-9e9e9e9e9e9e';
    await insertMailer(long, '9e9e9e9e9e9e', [seed.agencyId]);

    const first = await createLead({
      quoteControlNumber: long,
      address: {
        street: '7 Dedupe Dr',
        city: 'Tulsa',
        state: 'OK',
        zip: '74133',
      },
    }).expect(201);
    const second = await createLead({
      quoteControlNumber: '9e9e-9e9e-9e9e',
      address: {
        street: '99 Somewhere Else',
        city: 'Tulsa',
        state: 'OK',
        zip: '74999',
      },
    }).expect(201);

    expect((second.body as { id: string }).id).toBe(
      (first.body as { id: string }).id,
    );
  });
});
