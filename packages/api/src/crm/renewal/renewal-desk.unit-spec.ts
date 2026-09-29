import { RENEWAL_DESK_PREVIEW_DAYS } from '@sfa/shared';
import type { RenewalDeskRow } from '@sfa/shared';
import { compareRenewalDeskRows, renewalPreviewCutoff } from './renewal-desk';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-09T09:00:00.000Z');

/**
 * A desk row with only the fields the ordering reads. Every desk row is a call
 * that has not opened (PAC-143), so the defaults describe one.
 */
const row = (
  over: Partial<RenewalDeskRow> & { cycleId: string },
): RenewalDeskRow => ({
  ticketId: 't',
  ticketNumber: 'RENEW-1',
  stepKey: 'renewal_review',
  label: 'Renewal Review Call',
  track: 'annual',
  clientName: 'Client',
  householdId: null,
  householdName: '',
  policyCount: 1,
  policies: [],
  renewalDate: NOW.toISOString(),
  daysUntilRenewal: 45,
  availableAt: null,
  dueAt: null,
  daysUntilAvailable: 3,
  assignedUserId: null,
  assignedRep: '',
  status: 'waiting',
  isActionable: false,
  isOverdue: false,
  mergedFrom: [],
  outcome: null,
  ...over,
});

const order = (rows: RenewalDeskRow[]) =>
  [...rows].sort(compareRenewalDeskRows).map((r) => r.cycleId);

describe('renewalPreviewCutoff', () => {
  it('reaches exactly the preview window ahead of now', () => {
    expect(renewalPreviewCutoff(NOW).getTime()).toBe(
      NOW.getTime() + RENEWAL_DESK_PREVIEW_DAYS * DAY_MS,
    );
  });

  it('is two weeks — the window the desk is documented and tested against', () => {
    expect(RENEWAL_DESK_PREVIEW_DAYS).toBe(14);
  });
});

describe('compareRenewalDeskRows', () => {
  it('counts down by when each call opens', () => {
    // `later` renews sooner, so this also pins that opening order wins.
    const later = row({
      cycleId: 'later',
      daysUntilAvailable: 12,
      daysUntilRenewal: 57,
    });
    const sooner = row({
      cycleId: 'sooner',
      daysUntilAvailable: 1,
      daysUntilRenewal: 91,
    });
    expect(order([later, sooner])).toEqual(['sooner', 'later']);
  });

  it('breaks a tie on opening day by the sooner renewal', () => {
    const far = row({
      cycleId: 'far',
      daysUntilAvailable: 4,
      daysUntilRenewal: 94,
    });
    const near = row({
      cycleId: 'near',
      daysUntilAvailable: 4,
      daysUntilRenewal: 49,
    });
    expect(order([far, near])).toEqual(['near', 'far']);
  });

  it('puts a call opening later today first', () => {
    const today = row({ cycleId: 'today', daysUntilAvailable: 0 });
    const tomorrow = row({ cycleId: 'tomorrow', daysUntilAvailable: 1 });
    expect(order([tomorrow, today])).toEqual(['today', 'tomorrow']);
  });
});
