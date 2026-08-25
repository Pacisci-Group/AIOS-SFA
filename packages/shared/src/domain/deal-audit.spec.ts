import {
  AUDIT_REVIEW_OUTCOMES,
  DEAL_AUDIT_REASON_CODES,
  DEAL_AUDIT_STATUSES,
  DEFAULT_DEAL_AUDIT_STATUS,
  canReviewAudit,
  canSubmitAudit,
  normalizeDealAuditStatus,
} from './deal-audit';
import type { DealAuditStatus } from './deal-audit';

/**
 * The audit state machine (PAC-72).
 *
 * Pinned because the vocabulary has four writers — audit generation, the
 * migration, the demo seed and the post-sale fixture — and they disagreed with
 * each other for months. The values below are SmartSuite's own `deal_audit_status`
 * choice codes; changing one silently desynchronises the app from migrated data.
 */
describe('deal audit vocabulary', () => {
  it('is exactly the legacy four-state vocabulary, in progression order', () => {
    expect(DEAL_AUDIT_STATUSES).toEqual([
      'Not Submitted',
      'Pending',
      'Pass',
      'Fail',
    ]);
  });

  it('starts an audit at Not Submitted', () => {
    // Generation stamps this the moment a deal is sold. `Pending` would be
    // wrong — it means "with the reviewer", not "nothing has happened yet".
    expect(DEFAULT_DEAL_AUDIT_STATUS).toBe('Not Submitted');
  });

  it('uses SmartSuite reason codes, not invented ones', () => {
    // The demo seed used to write MISSING_DOC / PREMIUM_VAR / SIG_MISSING,
    // none of which exist in the legacy table.
    expect(DEAL_AUDIT_REASON_CODES).toContain('Missing Docs');
    expect(DEAL_AUDIT_REASON_CODES).toContain('Underwriting Issue');
    expect(DEAL_AUDIT_REASON_CODES).toHaveLength(6);
  });
});

describe('review outcomes', () => {
  it('maps each decision to its resulting state', () => {
    expect(AUDIT_REVIEW_OUTCOMES.approve).toBe('Pass');
    expect(AUDIT_REVIEW_OUTCOMES.request_changes).toBe('Fail');
    expect(AUDIT_REVIEW_OUTCOMES.send_back).toBe('Not Submitted');
  });

  it('keeps request_changes and send_back distinct despite both returning it', () => {
    // They differ in meaning — "this failed review" vs "this isn't ready" —
    // and the timeline records them as different events. Folding them into one
    // decision would lose that permanently.
    expect(AUDIT_REVIEW_OUTCOMES.request_changes).not.toBe(
      AUDIT_REVIEW_OUTCOMES.send_back,
    );
  });
});

describe('canSubmitAudit', () => {
  it('allows a fresh audit', () => {
    expect(canSubmitAudit('Not Submitted')).toBe(true);
  });

  it('allows re-submitting a failed audit — this is the correction loop', () => {
    // Section B item 8: Fail → producer corrects → back to Pending. Blocking
    // this would leave a failed audit permanently stuck.
    expect(canSubmitAudit('Fail')).toBe(true);
  });

  it('rejects one already awaiting review', () => {
    expect(canSubmitAudit('Pending')).toBe(false);
  });

  it('allows re-opening a passed audit', () => {
    // Deliberate: a pass discovered to be wrong has to be correctable, and
    // nothing else in the machine can move it off `Pass`.
    expect(canSubmitAudit('Pass')).toBe(true);
  });
});

describe('canReviewAudit', () => {
  it('only accepts an audit awaiting review', () => {
    const reviewable = DEAL_AUDIT_STATUSES.filter(canReviewAudit);

    expect(reviewable).toEqual(['Pending']);
  });
});

describe('normalizeDealAuditStatus', () => {
  it('passes canonical values through', () => {
    for (const status of DEAL_AUDIT_STATUSES) {
      expect(normalizeDealAuditStatus(status)).toBe(status);
    }
  });

  it('falls back to Not Submitted for the labels the seeds used to write', () => {
    // `In Progress` / `Complete` / `Not Started` are SmartSuite *labels*; the
    // stored value is the code. A stray label must render as "not submitted",
    // never leak through as-is.
    for (const stale of ['In Progress', 'Complete', 'Needs Review', 'Overdue']) {
      expect(normalizeDealAuditStatus(stale)).toBe('Not Submitted');
    }
  });

  it('handles null, undefined and empty', () => {
    expect(normalizeDealAuditStatus(null)).toBe('Not Submitted');
    expect(normalizeDealAuditStatus(undefined)).toBe('Not Submitted');
    expect(normalizeDealAuditStatus('')).toBe('Not Submitted');
  });

  it('returns a value the type system accepts without a cast', () => {
    const status: DealAuditStatus = normalizeDealAuditStatus('anything');

    expect(DEAL_AUDIT_STATUSES).toContain(status);
  });
});
