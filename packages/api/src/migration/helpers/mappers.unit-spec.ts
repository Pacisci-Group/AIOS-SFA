import {
  CANONICAL_LEAD_SOURCES,
  isTestRecord,
  normalizeLeadSource,
} from '@sfa/shared';
import {
  daysSince,
  deriveDealType,
  normalizeTemperature,
  policyTypeLabels,
  resolvePremium,
} from './derive';
import {
  firstLinkedId,
  selectCode,
  toDate,
  toNumber,
  toPhoneArray,
  toRichText,
  toStringArray,
  toYmd,
} from './value-utils';
import { Types } from 'mongoose';
import { buildLegacyTicket } from './legacy-ticket';

describe('lead source normalization', () => {
  it('maps canonical select codes to labels', () => {
    expect(normalizeLeadSource('WCO7l')).toMatchObject({
      code: 'WCO7l',
      label: 'Mailer',
      isCanonical: true,
    });
    expect(normalizeLeadSource('gjJUG').label).toBe('Soleo');
  });

  it('covers all 14 canonical sources', () => {
    expect(Object.keys(CANONICAL_LEAD_SOURCES)).toHaveLength(14);
  });

  it('folds non-canonical deal codes into a canonical bucket', () => {
    expect(normalizeLeadSource('65o7M')).toMatchObject({
      label: 'Book of Business',
      isCanonical: true,
    });
  });

  it('maps legacy Leads-table labels via alias', () => {
    expect(normalizeLeadSource('Mail').label).toBe('Mailer');
    expect(normalizeLeadSource('Referral Partner').label).toBe(
      'Customer Referral',
    );
  });

  it('keeps unknown sources non-canonical', () => {
    expect(normalizeLeadSource(undefined, 'Carrier Pigeon')).toMatchObject({
      label: 'Carrier Pigeon',
      isCanonical: false,
    });
  });
});

describe('test/sample/demo flagging', () => {
  it('flags the Test lead-source code', () => {
    expect(isTestRecord({ code: 'ENEJP', label: 'Test' })).toBe(true);
  });
  it('flags names containing test/sample/demo', () => {
    expect(isTestRecord(null, 'Sample Producer')).toBe(true);
    expect(isTestRecord(null, 'John Demo')).toBe(true);
    expect(isTestRecord(null, 'Jane Real')).toBe(false);
  });
});

describe('premium rollup + snapshot fallback', () => {
  it('prefers the rollup when > 0', () => {
    expect(resolvePremium('3042.78', '100')).toEqual({
      premium: 3042.78,
      source: 'rollup',
    });
  });
  it('falls back to snapshot when rollup is empty', () => {
    expect(resolvePremium(0, '250.50')).toEqual({
      premium: 250.5,
      source: 'snapshot',
    });
  });
  it('reports none when both empty', () => {
    expect(resolvePremium(undefined, null)).toEqual({
      premium: 0,
      source: 'none',
    });
  });
});

describe('deal type derivation', () => {
  it('bundle flag wins', () => {
    expect(deriveDealType(true, ['Auto'])).toBe('Bundle');
  });
  it('auto + home lines => Bundle', () => {
    expect(deriveDealType(false, ['Auto', 'Home'])).toBe('Bundle');
  });
  it('auto only => Auto', () => {
    expect(deriveDealType(false, ['Auto'])).toBe('Auto');
  });
  it('home-like only => Home', () => {
    expect(deriveDealType(false, ['Renters'])).toBe('Home');
  });
  it('unknown => Other', () => {
    expect(deriveDealType(false, ['Umbrella'])).toBe('Other');
  });

  it('translates policy type lookup codes to labels', () => {
    expect(policyTypeLabels([['PYgez'], ['sNMRK']])).toEqual(
      expect.arrayContaining(['Auto', 'Home']),
    );
  });

  it('emits the canonical Landlord spelling, not SmartSuite’s plural', () => {
    // The old migration-local map returned "Landlords" for `mCt4m`. The audit
    // generator (PAC-40) resolves template titles by exact name, so a plural
    // here means a landlord deal generates no landlord audit items at all.
    expect(policyTypeLabels([['mCt4m']])).toEqual(['Landlord']);
    expect(policyTypeLabels([['AiFB5']])).toEqual(['Landlord']);
  });

  it('collapses the two Landlord code sets to one label', () => {
    // A deal linking policies recorded under both code sets must not list the
    // same line of business twice.
    expect(policyTypeLabels([['mCt4m'], ['AiFB5']])).toEqual(['Landlord']);
  });

  it('passes an uncatalogued code through rather than dropping it', () => {
    expect(policyTypeLabels([['Dwelling Fire']])).toEqual(['Dwelling Fire']);
  });
});

describe('temperature + aging', () => {
  it('normalizes hydrated select temperature', () => {
    expect(normalizeTemperature({ value: 'Hot', label: 'Hot' })).toBe('Hot');
    expect(normalizeTemperature('Cold')).toBe('Cold');
    expect(normalizeTemperature(undefined)).toBe('Unknown');
  });
  it('computes non-negative aging days', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000);
    expect(daysSince(tenDaysAgo)).toBe(10);
    expect(daysSince(new Date(Date.now() + 86400000))).toBe(0);
  });
});

describe('SmartSuite value extraction', () => {
  it('parses currency strings', () => {
    expect(toNumber('232.00$')).toBe(232);
    expect(toNumber('3042.78')).toBeCloseTo(3042.78);
  });
  it('reads dates from { date } and { on: { date } }', () => {
    expect(toDate({ date: '2025-08-12T00:00:00Z' })?.getUTCFullYear()).toBe(
      2025,
    );
    expect(
      toDate({ on: { date: '2026-01-15T05:18:12Z' } })?.getUTCMonth(),
    ).toBe(0);
  });

  it('reads the { by, on: string } system-timestamp shape', () => {
    /*
     * The shape every table in `docs/smartsuite-tables/*` documents for
     * `first_created` / `last_updated` — `on` is a plain ISO string, not a
     * nested date object.
     *
     * This returned `undefined` until PAC-80, which is why `firstCreatedAt` was
     * unset on all 4,548 migrated audit items (collapsing the hand-off board's
     * "oldest first" sort onto the migration's own timestamp) and
     * `lastActivityAt` was null on 564 of 967 leads.
     */
    const parsed = toDate({
      by: '65550784e0d0dcc6fe3fc3aa',
      on: '2026-01-21T22:32:45.080000Z',
    });
    expect(parsed?.toISOString()).toBe('2026-01-21T22:32:45.080Z');
  });

  it('returns undefined for a system timestamp that was never set', () => {
    expect(toDate({ by: 'someone', on: null })).toBeUndefined();
    expect(toDate({ on: { date: null } })).toBeUndefined();
  });
  it('derives YYYYMMDD from a date', () => {
    expect(toYmd(new Date('2025-08-12T00:00:00Z'))).toBe(20250812);
  });
  it('extracts first linked record id', () => {
    expect(firstLinkedId(['69613aed0ff4e450871ce2d9'])).toBe(
      '69613aed0ff4e450871ce2d9',
    );
    expect(firstLinkedId([])).toBeUndefined();
  });
  it('extracts select code from hydrated object', () => {
    expect(selectCode({ value: 'WCO7l', label: 'Mailer' })).toBe('WCO7l');
  });
  it('extracts emails and phones', () => {
    expect(toStringArray(['a@b.com'])).toEqual(['a@b.com']);
    expect(
      toPhoneArray([{ phone_country: 'US', phone_number: '555 437 6488' }]),
    ).toEqual(['555 437 6488']);
  });
});

describe('toRichText', () => {
  it('prefers the SmartDoc preview', () => {
    expect(
      toRichText({
        data: { type: 'doc' },
        html: '<p>Check on <b>endorsement</b></p>',
        preview: 'Check on endorsement',
      }),
    ).toBe('Check on endorsement');
  });

  it('strips the html when the preview is blank', () => {
    expect(
      toRichText({
        data: {},
        html: '<p>Send&nbsp;updated <em>dec</em> pages.</p><p>Call back.</p>',
        preview: '',
      }),
    ).toBe('Send updated dec pages. Call back.');
  });

  it('passes a plain multi-line string through', () => {
    expect(toRichText('  lorem ipsum  ')).toBe('lorem ipsum');
  });

  it('is undefined for an empty doc, so the caller can fall back', () => {
    expect(toRichText({ data: {}, html: '', preview: '' })).toBeUndefined();
    expect(toRichText(null)).toBeUndefined();
    expect(toRichText('')).toBeUndefined();
  });
});

describe('buildLegacyTicket', () => {
  const opened = new Date('2026-01-29T16:56:59.962Z');
  const household = new Types.ObjectId();
  const policy = new Types.ObjectId();
  const crm = new Types.ObjectId();

  const source = () => ({
    title: '#SFAS-030',
    category: '4osEm',
    status: 'in_progress',
    priority: 'Urgent',
    clientName: 'Christopher Watson',
    crmName: 'Yessenia Campos',
    createdDate: opened,
    policyId: policy,
    householdId: household,
    assignedUserId: crm,
    createdByUserId: crm,
    isTestRecord: false,
  });

  it('builds the document the CRM would have written itself', () => {
    const fields = buildLegacyTicket(
      source(),
      {
        household: {
          name: 'Watson Household',
          primaryPhones: ['918 808 2556'],
          primaryEmails: ['cw@example.com'],
        },
        policy: { policyNumber: '845776459', policyType: 'Auto' },
      },
      new Date('2026-09-01T00:00:00Z'),
    );
    expect(fields).toMatchObject({
      ticketNumber: 'SFAS-30',
      clientName: 'Christopher Watson',
      category: 'Policy Change',
      status: 'in_progress',
      statusOverriddenAt: null,
      priority: 'high',
      assignedRep: 'Yessenia Campos',
      assignedUserId: crm,
      createdByUserId: crm,
      createdByName: 'Yessenia Campos',
      policyNumber: '845776459',
      policyType: 'Auto',
      household: 'Watson Household',
      policyId: policy,
      householdId: household,
      leadId: null,
      phone: '918 808 2556',
      email: 'cw@example.com',
      openedAt: opened,
      lastActivityAt: opened,
      resolvedAt: null,
      onboarding: null,
      renewal: null,
      isTestRecord: false,
    });
    expect(fields?.timeline).toEqual([
      {
        type: 'created',
        author: 'Yessenia Campos',
        content: 'Ticket opened — Policy Change.',
        at: opened,
      },
    ]);
  });

  it('opens the timeline with the ticket body when there is one', () => {
    const fields = buildLegacyTicket({
      ...source(),
      notes: 'Check on endorsement (adding vehicle), send updated dec pages.',
      createdByName: 'Ashley Medina',
    });
    expect(fields?.timeline).toEqual([
      expect.objectContaining({
        author: 'Ashley Medina',
        content:
          'Check on endorsement (adding vehicle), send updated dec pages.',
      }),
    ]);
    expect(fields?.createdByName).toBe('Ashley Medina');
  });

  it('marks a legacy Onboarding row as status-overridden', () => {
    // No `onboarding` payload for the schedule to derive from, so the stored
    // status has to be the one the queue filters read.
    const fields = buildLegacyTicket({ ...source(), category: 'Onboarding' });
    expect(fields?.statusOverriddenAt).toEqual(opened);
    expect(fields?.onboarding).toBeNull();
  });

  it('ages a closed ticket out on its last touch when no resolve date exists', () => {
    const touched = new Date('2026-02-10T00:00:00Z');
    const fields = buildLegacyTicket({
      ...source(),
      status: 'Closed',
      lastUpdated: touched,
    });
    expect(fields?.status).toBe('closed');
    expect(fields?.resolvedAt).toBeNull();
    expect(fields?.lastActivityAt).toEqual(touched);
  });

  it('falls back to the household for a blank client name', () => {
    expect(
      buildLegacyTicket(
        { ...source(), clientName: '' },
        { household: { name: 'Nick A Huddleston' } },
      )?.clientName,
    ).toBe('Nick A Huddleston');
    expect(buildLegacyTicket({ ...source(), clientName: '' })?.clientName).toBe(
      'Unnamed client',
    );
  });

  it('refuses a row whose title is not a ticket number', () => {
    expect(buildLegacyTicket({ ...source(), title: 'Record 1' })).toBeNull();
    expect(buildLegacyTicket({ ...source(), title: undefined })).toBeNull();
  });
});
