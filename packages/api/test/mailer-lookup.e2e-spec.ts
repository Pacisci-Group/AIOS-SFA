import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { MailerLookupView, mailerControlNumberKeys } from '@sfa/shared';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Contact } from '../src/contacts/schemas/contact.schema';
import { Household } from '../src/households/schemas/household.schema';
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

/**
 * The two printed forms of one control number, related the way the real data
 * relates them: the short code is the last 12 hex characters of the UUID inside
 * the long form. That relationship is the whole reason both are stored — see
 * `mailerControlNumberKeys`.
 */
const LONG = '#3f2a91c7-4d5e-4b8a-9f10-9c41b2d70e58';
const SHORT = '9c41b2d70e58';

/** A second mailer, for the tests that need one with nothing on it. */
const NAMELESS_LONG = '#11112222-3333-4444-5555-666677778888';

interface MailerSeed {
  controlNumber?: string;
  newControlNumber?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  county?: string;
  state?: string;
  street?: string;
}

/**
 * The QCN lookup and log-lead behind the Mailers drawer (PAC-61).
 *
 * ⚠ e2e suites share one database — never run two at once. `npm run test:e2e`
 * passes `--runInBand` for exactly this reason.
 */
describe('Mailer lookup + log lead (e2e)', () => {
  let app: INestApplication<App>;
  let seed: TestSeedContext;
  let mailerModel: Model<Mailer>;
  let leadModel: Model<Lead>;
  let householdModel: Model<Household>;
  let contactModel: Model<Contact>;
  let producerToken: string;
  let readOnlyToken: string;

  /** Insert one mailer, in the same shape the importer would have written. */
  async function insertMailer(
    agencyId: string,
    overrides: MailerSeed = {},
  ): Promise<void> {
    const controlNumber = overrides.controlNumber ?? LONG;
    const newControlNumber =
      'newControlNumber' in overrides ? overrides.newControlNumber : SHORT;

    await mailerModel.create({
      agencyId,
      controlNumber,
      newControlNumber,
      controlNumberKeys: mailerControlNumberKeys(
        controlNumber,
        newControlNumber,
      ),
      firstName: 'firstName' in overrides ? overrides.firstName : 'Dana',
      lastName: 'lastName' in overrides ? overrides.lastName : 'Whitfield',
      fullName: 'fullName' in overrides ? overrides.fullName : 'Dana Whitfield',
      address: {
        street: overrides.street ?? '1420 S Birch Ave',
        city: 'Tulsa',
        state: 'state' in overrides ? overrides.state : 'OK',
        zip: '74133-5807',
        zip5: '74133',
        zip4: '5807',
        county: 'county' in overrides ? overrides.county : '143',
      },
      squareFeet: 2410,
      yearBuilt: 1998,
      coverage: {
        dwelling: 412000,
        otherStructures: 41200,
        lossOfUse: 41200,
        guestMedical: 1000,
        familyLiability: 100000,
      },
      // Deliberately disagreeing, as they do on every real row.
      premium: { total: 3096.65, yearly: 1886.15, monthly: 157.18 },
      campaign: {
        campaignNumber: 'Week_Number-29',
        weekNumber: 29,
        fileName: 'SFA-20P',
        policyType: 'Home',
        product: 'FQ',
      },
      quoteDate: new Date('2026-07-13T00:00:00.000Z'),
      market: 'Tulsa',
      agencyPhone: '918-984-6163',
      doNotCall: false,
      doNotMail: false,
      isTestRecord: false,
      source: {
        system: 'spreadsheet',
        fileName: 'SFA-20P',
        uploadedFilename: 'rtp.csv',
        storageKey: 'agencies/x/mailer-imports/2026/rtp.csv',
        raw: { controlno: controlNumber, secret: 'must not be returned' },
      },
    });
  }

  function lookup(qcn: string, token = producerToken) {
    return request(app.getHttpServer())
      .get(`/api/v1/mailers/${encodeURIComponent(qcn)}`)
      .set(authHeader(token));
  }

  function logLead(controlNumber: string, token = producerToken) {
    return request(app.getHttpServer())
      .post('/api/v1/mailers/log-lead')
      .set(authHeader(token))
      .send({ controlNumber });
  }

  beforeAll(async () => {
    app = await createTestApp();
    seed = await seedTestData(app);
    mailerModel = app.get<Model<Mailer>>(getModelToken(Mailer.name));
    leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));
    householdModel = app.get<Model<Household>>(getModelToken(Household.name));
    contactModel = app.get<Model<Contact>>(getModelToken(Contact.name));

    producerToken = (await login(app, seed.producerEmail, TEST_PASSWORD))
      .accessToken;
    readOnlyToken = (await login(app, seed.readOnlyEmail, TEST_PASSWORD))
      .accessToken;

    await insertMailer(seed.agencyId);
  });

  afterAll(async () => {
    await dropTestDatabase(app);
    await closeTestApp(app);
  });

  describe('GET /mailers/:controlNumber', () => {
    it('resolves the long form', async () => {
      const res = await lookup(LONG).expect(200);
      const body = res.body as MailerLookupView;

      expect(body.controlNumber).toBe(LONG);
      expect(body.newControlNumber).toBe(SHORT);
      expect(body.name).toBe('Dana Whitfield');
    });

    it('resolves the short form to the same mailer', async () => {
      // The point of storing both normalized forms. Legacy could only do this
      // with an ENDS_WITH substring scan.
      const res = await lookup(SHORT).expect(200);
      expect((res.body as MailerLookupView).controlNumber).toBe(LONG);
    });

    it.each([
      ['uppercased', SHORT.toUpperCase()],
      ['padded with whitespace', `  ${SHORT}  `],
      ['re-punctuated', '9c41-b2d7-0e58'],
      ['long form without its hash or dashes', LONG.replace(/[#-]/g, '')],
    ])('is tolerant of input %s', async (_label, typed) => {
      const res = await lookup(typed).expect(200);
      expect((res.body as MailerLookupView).controlNumber).toBe(LONG);
    });

    it('404s an unknown control number', async () => {
      await lookup('NOSUCHQCN123').expect(404);
    });

    it('404s rather than 500s on input that normalizes to nothing', async () => {
      await lookup('---').expect(404);
    });

    it('404s a mailer belonging to another agency', async () => {
      // Tenant isolation is the assertion; a mailer is agency-scoped with no
      // branch dimension, so this is the only boundary it has.
      const foreign = '#99998888-7777-6666-5555-444433332222';
      await insertMailer('6a86ef5140258c85a093cc4e', {
        controlNumber: foreign,
        newControlNumber: '444433332222',
      });

      await lookup(foreign).expect(404);
    });

    it('renders county as a name, never the raw FIPS code', async () => {
      const res = await lookup(LONG).expect(200);
      const { county } = (res.body as MailerLookupView).address;

      expect(county).toBe('Tulsa County');
      expect(county).not.toMatch(/^\d{3}$/);
    });

    it('returns a null county rather than a stand-in when unmapped', async () => {
      // The table is Oklahoma-only today. An Illinois mailer must produce
      // nothing at all, so the drawer can omit the row — not `143`, not a dash.
      const qcn = '#aaaabbbb-cccc-dddd-eeee-ffff00001111';
      await insertMailer(seed.agencyId, {
        controlNumber: qcn,
        newControlNumber: 'ffff00001111',
        state: 'IL',
      });

      const res = await lookup(qcn).expect(200);
      expect((res.body as MailerLookupView).address.county).toBeNull();
    });

    it('leaks no internals', async () => {
      // `source.raw` is the entire 132-column source row. Everything here is
      // withheld deliberately — see the docblock on `MailerLookupView`.
      const res = await lookup(LONG).expect(200);
      const body = res.body as Record<string, unknown>;

      expect(body).not.toHaveProperty('_id');
      expect(body).not.toHaveProperty('agencyId');
      expect(body).not.toHaveProperty('source');
      expect(body).not.toHaveProperty('isTestRecord');
      expect(body).not.toHaveProperty('agencyPhone');
      expect(body).not.toHaveProperty('market');
      expect(JSON.stringify(body)).not.toContain('must not be returned');
    });

    it('carries both premiums and the quoted coverage', async () => {
      const res = await lookup(LONG).expect(200);
      const body = res.body as MailerLookupView;

      // Stored side by side and never reconciled — they disagree on every real
      // row, and which one a producer quotes is still an open product question.
      expect(body.premium).toEqual({
        yearly: 1886.15,
        monthly: 157.18,
        total: 3096.65,
      });
      expect(body.coverage.dwelling).toBe(412000);
      expect(body.coverage.familyLiability).toBe(100000);
    });

    it('reports no campaign status for an uploaded mailer', async () => {
      // `campaign_status` is a BigQuery-only column. Legacy invented a
      // hard-coded 'Pending' here; null is the honest answer.
      const res = await lookup(LONG).expect(200);
      const { campaign } = res.body as MailerLookupView;

      expect(campaign.status).toBeNull();
      expect(campaign.weekNumber).toBe(29);
      expect(campaign.policyType).toBe('Home');
    });

    it('surfaces the suppression flags', async () => {
      const res = await lookup(LONG).expect(200);
      const body = res.body as MailerLookupView;

      expect(body.doNotCall).toBe(false);
      expect(body.doNotMail).toBe(false);
    });
  });

  describe('POST /mailers/log-lead', () => {
    it('403s a user holding mailers:read but not leads:write', async () => {
      // The read-only role has `<module>:read` on every module, so this pins
      // the AND-set on the route rather than the module gate.
      await logLead(SHORT, readOnlyToken).expect(403);
    });

    it('creates the lead, household and contact', async () => {
      const res = await logLead(LONG).expect(200);
      const { leadId, alreadyExisted } = res.body as {
        leadId: string;
        alreadyExisted: boolean;
      };

      expect(alreadyExisted).toBe(false);

      const lead = await leadModel.findById(leadId).lean();
      expect(lead).toBeTruthy();
      expect(lead!.firstName).toBe('Dana');
      expect(lead!.lastName).toBe('Whitfield');
      // Always Mailer, set server-side. The legacy JYA branch is not ported.
      expect(lead!.leadSource?.code).toBe('WCO7l');
      // The LONG form: it is searchable by either, and the short form is only
      // 48 bits of a truncated UUID.
      expect(lead!.quoteControlNumber).toBe(LONG);
      expect(lead!.intakeSource?.channel).toBe('mailer');
      expect(lead!.submissionToken).toBe(
        `MAIL|${mailerControlNumberKeys(LONG, SHORT)[0]}`,
      );

      expect(
        await householdModel.findById(lead!.householdId).lean(),
      ).toBeTruthy();
      expect(
        await contactModel.findById(lead!.primaryContactId).lean(),
      ).toBeTruthy();
    });

    it('assigns the caller as producer', async () => {
      const lead = await leadModel.findOne({ quoteControlNumber: LONG }).lean();
      expect(lead!.producerId).toBeTruthy();
    });

    it('stores the 5-digit zip, not the ZIP+4', async () => {
      // `buildAddressKey` keys on `street|zip`, so a ZIP+4 here would stop this
      // lead ever deduping against one typed in by hand at the same house.
      const lead = await leadModel.findOne({ quoteControlNumber: LONG }).lean();
      expect(lead!.address?.zip).toBe('74133');
    });

    it('is idempotent — a replay returns the same lead', async () => {
      const before = await leadModel.countDocuments({
        quoteControlNumber: LONG,
      });

      const res = await logLead(LONG).expect(200);
      const body = res.body as { leadId: string; alreadyExisted: boolean };
      expect(body.alreadyExisted).toBe(true);

      expect(await leadModel.countDocuments({ quoteControlNumber: LONG })).toBe(
        before,
      );
    });

    it('is idempotent across BOTH control-number forms', async () => {
      // The assertion the ticket's literal `MAIL|${QCN.toUpperCase()}` spec
      // would have failed: keying on what the producer typed makes the two
      // printed forms two different tokens, and one mailer becomes two leads.
      const first = await leadModel
        .findOne({ quoteControlNumber: LONG })
        .lean();

      const res = await logLead(SHORT).expect(200);
      const body = res.body as { leadId: string; alreadyExisted: boolean };

      expect(body.alreadyExisted).toBe(true);
      expect(body.leadId).toBe(first!._id.toString());
      expect(await leadModel.countDocuments({ quoteControlNumber: LONG })).toBe(
        1,
      );
    });

    it('reports the logged lead back through the lookup', async () => {
      const res = await lookup(SHORT).expect(200);
      const body = res.body as MailerLookupView;

      expect(body.alreadyLogged).toBe(true);
      // The producer logged it, so it is inside their own `own` scope and the
      // drawer may offer a link to it.
      expect(body.linkedLeadId).toBeTruthy();
    });

    it('404s an unknown control number', async () => {
      await logLead('NOSUCHQCN123').expect(404);
    });

    it('422s a mailer with no usable recipient name', async () => {
      // Not 400 — the request body was fine. Not 404 — the mailer exists.
      await insertMailer(seed.agencyId, {
        controlNumber: NAMELESS_LONG,
        newControlNumber: '666677778888',
        firstName: undefined,
        lastName: undefined,
        fullName: undefined,
      });

      await logLead(NAMELESS_LONG).expect(422);
    });

    it('creates a lead from a single-token name', async () => {
      // One token goes to `lastName`, so the household reads "Okafor
      // Household" rather than "New Household".
      const qcn = '#12341234-5678-5678-9abc-9abcdef01234';
      await insertMailer(seed.agencyId, {
        controlNumber: qcn,
        newControlNumber: '9abcdef01234',
        firstName: undefined,
        lastName: undefined,
        fullName: 'Okafor',
        // A distinct street on purpose. Every other mailer here shares one
        // address, and intake's address dedupe (signal 3) would otherwise
        // correctly merge this into the lead the earlier tests created —
        // proving the dedupe works, but not what this test is about.
        street: '88 W Sycamore Ln',
      });

      const res = await logLead(qcn).expect(200);
      const lead = await leadModel
        .findById((res.body as { leadId: string }).leadId)
        .lean();

      expect(lead!.lastName).toBe('Okafor');
    });
  });
});
