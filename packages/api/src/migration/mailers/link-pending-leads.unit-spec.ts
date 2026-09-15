import { planLeadLinks } from './link-pending-leads';

const mailer = (mailerId: string, campaignId = 'campaign-1') => ({
  mailerId,
  campaignId,
});

describe('planLeadLinks', () => {
  it('links a mailer exactly one lead claims', () => {
    const plan = planLeadLinks([
      { leadId: 'lead-1', key: 'AAA111', mailer: mailer('mailer-1') },
      { leadId: 'lead-2', key: 'BBB222', mailer: mailer('mailer-2', 'c2') },
    ]);

    expect(plan.links).toEqual([
      {
        leadId: 'lead-1',
        key: 'AAA111',
        mailerId: 'mailer-1',
        campaignId: 'campaign-1',
      },
      {
        leadId: 'lead-2',
        key: 'BBB222',
        mailerId: 'mailer-2',
        campaignId: 'c2',
      },
    ]);
    expect(plan.conflicts).toEqual([]);
  });

  it('leaves a mailer several leads claim for a person, even via different printed forms', () => {
    // The long and short forms are different keys for the same mailer.
    // Grouping by key would let both through and die on the unique index.
    const plan = planLeadLinks([
      {
        leadId: 'lead-1',
        key: 'D3D00000AAAAAAAAF00D0000BBBBBBBB',
        mailer: mailer('mailer-1'),
      },
      { leadId: 'lead-2', key: '0000BBBBBBBB', mailer: mailer('mailer-1') },
      { leadId: 'lead-3', key: 'CCC333', mailer: mailer('mailer-3') },
    ]);

    expect(plan.links.map((link) => link.leadId)).toEqual(['lead-3']);
    expect(plan.conflicts).toEqual([
      { mailerId: 'mailer-1', leadIds: ['lead-1', 'lead-2'] },
    ]);
  });

  it('counts waiting leads whose key matched nothing this run wrote', () => {
    const plan = planLeadLinks([
      { leadId: 'lead-1', key: 'AAA111', mailer: null },
      { leadId: 'lead-2', key: 'BBB222', mailer: mailer('mailer-2') },
    ]);

    expect(plan.unmatched).toBe(1);
    expect(plan.links).toHaveLength(1);
  });
});
