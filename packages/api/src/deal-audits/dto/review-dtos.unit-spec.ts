import { listDealAuditQueueSchema } from './list-deal-audit-queue.dto';
import { listDealAuditsSchema } from './list-deal-audits.dto';
import { reviewAuditSchema } from './review-audit.dto';
import { setItemVerdictSchema } from './set-item-verdict.dto';

/** The request rules of the manager's review (PAC-106) — each one a 400. */
describe('deal audit review DTOs (PAC-106)', () => {
  describe('reviewAuditSchema', () => {
    it('needs a note to send an audit back', () => {
      // The note is the producer's red card and the notification body.
      expect(
        reviewAuditSchema.safeParse({ decision: 'request_changes' }).success,
      ).toBe(false);
      expect(
        reviewAuditSchema.safeParse({
          decision: 'request_changes',
          notes: '   ',
        }).success,
      ).toBe(false);
    });

    it('no longer needs a reason code to send one back', () => {
      expect(
        reviewAuditSchema.parse({
          decision: 'request_changes',
          notes: 'The transcript is from 2019.',
        }),
      ).toMatchObject({ notes: 'The transcript is from 2019.' });
    });

    it('approves with or without a note', () => {
      expect(reviewAuditSchema.safeParse({ decision: 'approve' }).success).toBe(
        true,
      );
    });
  });

  describe('setItemVerdictSchema', () => {
    it('takes a verdict, a note, or both', () => {
      expect(setItemVerdictSchema.parse({ verdict: 'pass' })).toEqual({
        verdict: 'pass',
      });
      expect(setItemVerdictSchema.parse({ note: 'Checked.' })).toEqual({
        note: 'Checked.',
      });
      expect(
        setItemVerdictSchema.parse({ verdict: 'fail', note: ' Wrong date ' }),
      ).toEqual({ verdict: 'fail', note: 'Wrong date' });
    });

    it('withdraws a ruling with null, and clears a note with ""', () => {
      expect(setItemVerdictSchema.parse({ verdict: null })).toEqual({
        verdict: null,
      });
      expect(setItemVerdictSchema.parse({ note: '' })).toEqual({ note: '' });
    });

    it('refuses an empty request and an unknown verdict', () => {
      expect(setItemVerdictSchema.safeParse({}).success).toBe(false);
      expect(setItemVerdictSchema.safeParse({ verdict: 'maybe' }).success).toBe(
        false,
      );
      expect(
        setItemVerdictSchema.safeParse({ note: 'x'.repeat(2001) }).success,
      ).toBe(false);
    });
  });

  describe('listDealAuditQueueSchema', () => {
    const parse = (query: Record<string, unknown>) =>
      listDealAuditQueueSchema.safeParse(query);
    const id = '6ab27a2c8bded56c719a4c68';

    it('defaults to everything not yet approved, all time, longest waiting first', () => {
      expect(listDealAuditQueueSchema.parse({})).toEqual({
        status: 'open',
        aging: false,
        // All time — not the dashboards' month-to-date: last month's open
        // audits are the ones a manager most needs to see.
        range: 'all',
        sort: 'waiting',
        page: 1,
        pageSize: 25,
      });
    });

    it('trims the search, and reads a cleared box as no search', () => {
      expect(listDealAuditQueueSchema.parse({ q: '  zeta ' }).q).toBe('zeta');
      expect(listDealAuditQueueSchema.parse({ q: '   ' }).q).toBeUndefined();
      expect(parse({ q: 'x'.repeat(121) }).success).toBe(false);
    });

    it('takes producers and lines in the repeated or comma form', () => {
      const other = '6ab27a2c8bded56c719a4c69';
      expect(
        listDealAuditQueueSchema.parse({ producerIds: [id, other] })
          .producerIds,
      ).toEqual([id, other]);
      expect(
        listDealAuditQueueSchema.parse({ producerIds: `${id},${other}` })
          .producerIds,
      ).toEqual([id, other]);
      expect(
        listDealAuditQueueSchema.parse({ policyTypes: 'Home,Auto' })
          .policyTypes,
      ).toEqual(['Home', 'Auto']);
      expect(parse({ producerIds: 'nope' }).success).toBe(false);
      expect(parse({ policyTypes: 'Boat' }).success).toBe(false);
    });

    it('reads aging as a strict true / false', () => {
      expect(listDealAuditQueueSchema.parse({ aging: 'true' }).aging).toBe(
        true,
      );
      expect(listDealAuditQueueSchema.parse({ aging: 'false' }).aging).toBe(
        false,
      );
      expect(parse({ aging: 'yes' }).success).toBe(false);
    });

    it('needs both dates, in order, for a custom period', () => {
      expect(parse({ range: 'custom' }).success).toBe(false);
      expect(
        parse({ range: 'custom', from: '2026-10-10', to: '2026-10-01' })
          .success,
      ).toBe(false);
      expect(
        parse({ range: 'custom', from: '2026-10-01', to: '2026-10-10' })
          .success,
      ).toBe(true);
      // Stray dates on a preset are ignored, not refused.
      expect(parse({ range: 'all', from: '2026-10-01' }).success).toBe(true);
      expect(parse({ range: 'last12Months' }).success).toBe(true);
      expect(parse({ range: 'forever' }).success).toBe(false);
    });

    it('refuses an unknown sort', () => {
      expect(parse({ sort: 'producer' }).success).toBe(true);
      expect(parse({ sort: 'bogus' }).success).toBe(false);
    });

    it('refuses an unknown status and an oversized page', () => {
      expect(
        listDealAuditQueueSchema.safeParse({ status: 'Pending' }).success,
      ).toBe(false);
      expect(
        listDealAuditQueueSchema.safeParse({ pageSize: '101' }).success,
      ).toBe(false);
    });
  });

  describe('listDealAuditsSchema dealId', () => {
    it('takes an ObjectId and nothing else', () => {
      const id = '6ab27a2c8bded56c719a4c68';
      expect(listDealAuditsSchema.parse({ dealId: id }).dealId).toBe(id);
      expect(
        listDealAuditsSchema.safeParse({ dealId: 'not-an-id' }).success,
      ).toBe(false);
    });
  });
});
