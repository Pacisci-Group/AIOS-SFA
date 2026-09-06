import { Types } from 'mongoose';
import { implicitCampaignDoc, implicitCampaignKey } from './implicit-campaign';

/**
 * The key is a contract between three unrelated writers — the PAC-71 backfill,
 * the BigQuery CLI and the demo seed. A drift in any of them splits mailers that
 * belong together across two campaigns, which then reads as a duplicate run that
 * never happened. These assertions are the contract.
 */
describe('implicitCampaignKey', () => {
  const agencyId = '6a86ef5140258c85a093cc4e';

  it('joins agency, week and year', () => {
    expect(implicitCampaignKey({ agencyId, weekNumber: 29, year: 2026 })).toBe(
      `${agencyId}|29|2026`,
    );
  });

  it('collapses a missing week and year onto one catch-all per agency', () => {
    // One bucket per agency, not one per un-dated row — and never an invented
    // week number.
    const a = implicitCampaignKey({ agencyId, weekNumber: null, year: null });
    const b = implicitCampaignKey({ agencyId, weekNumber: null, year: null });
    expect(a).toBe(`${agencyId}|unknown|unknown`);
    expect(a).toBe(b);
  });

  it('keeps week 0 distinct from an unknown week', () => {
    // `0` is falsy; a `||` in place of the null check would fold a real week 0
    // into the catch-all bucket.
    expect(implicitCampaignKey({ agencyId, weekNumber: 0, year: 2026 })).toBe(
      `${agencyId}|0|2026`,
    );
  });

  it('separates two agencies with the same week', () => {
    const other = '6a86ef5140258c85a093cc4f';
    expect(
      implicitCampaignKey({ agencyId, weekNumber: 29, year: 2026 }),
    ).not.toBe(
      implicitCampaignKey({ agencyId: other, weekNumber: 29, year: 2026 }),
    );
  });
});

describe('implicitCampaignDoc', () => {
  const carrierId = new Types.ObjectId();
  const key = {
    agencyId: '6a86ef5140258c85a093cc4e',
    weekNumber: 29,
    year: 2026,
  };

  it('describes a run that already happened', () => {
    const doc = implicitCampaignDoc(key, { carrierId, source: 'migration' });

    // The mailers are already in the collection — there is nothing to perform.
    expect(doc.status).toBe('imported');
    // Nothing recorded the original floor or discount table. Today's defaults
    // would make the record look reproducible when it is not.
    expect(doc.settings).toBeNull();
    expect(doc.requestedBy).toBeNull();
    expect(doc.migrationKey).toBe(implicitCampaignKey(key));
  });

  it('carries the rows tenancy across as an explicit agency list', () => {
    const doc = implicitCampaignDoc(key, { carrierId, source: 'migration' });

    // Never `all`: `agencyId` was the whole of these rows' tenancy, and widening
    // it would expose one agency's prospects to every other tenant.
    expect(doc.assignment).toEqual({
      mode: 'agencies',
      agencyIds: [key.agencyId],
    });
  });

  it('names the campaign after the agency, week and year', () => {
    const doc = implicitCampaignDoc(key, {
      carrierId,
      agencyName: 'Smith Family Agency',
      fileName: 'SFA-20P',
      source: 'migration',
    });
    expect(doc.name).toBe('Smith Family Agency — week 29 2026 (SFA-20P)');
  });

  it('falls back to the agency id when the name is unknown', () => {
    const doc = implicitCampaignDoc(key, { carrierId, source: 'migration' });
    expect(doc.name).toBe(`${key.agencyId} — week 29 2026`);
  });

  it('says "unknown week" rather than inventing one', () => {
    const doc = implicitCampaignDoc(
      { ...key, weekNumber: null, year: null },
      { carrierId, agencyName: 'Demo Agency', source: 'demo' },
    );
    expect(doc.name).toBe('Demo Agency — unknown week');
    expect(doc.weekNumber).toBeNull();
    expect(doc.year).toBeNull();
  });

  it('writes null rather than undefined for an absent campaign number', () => {
    // The backfill writes this through the raw driver, which serialises
    // `undefined` to `null` anyway — being explicit keeps the Mongoose and
    // driver paths producing the same document.
    const doc = implicitCampaignDoc(key, { carrierId, source: 'migration' });
    expect(doc.campaignNumber).toBeNull();
  });
});
