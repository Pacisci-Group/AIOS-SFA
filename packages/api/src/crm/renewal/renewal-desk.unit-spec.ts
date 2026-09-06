import { RENEWAL_DESK_PREVIEW_DAYS } from '@sfa/shared';
import type { RenewalDeskRow } from '@sfa/shared';
import {
  compareRenewalDeskRows,
  isScheduledDeskRow,
  renewalPreviewCutoff,
} from './renewal-desk';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-09T09:00:00.000Z');

/**
 * A desk row with only the fields the ordering reads. `daysUntilAvailable`
 * null means the call is open — the same contract the wire type carries.
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
  daysUntilAvailable: null,
  status: 'open',
  isActionable: true,
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

describe('isScheduledDeskRow', () => {
  it('is a preview exactly when the call has not opened', () => {
    expect(isScheduledDeskRow({ daysUntilAvailable: 5 })).toBe(true);
    // Opening today still counts as scheduled — it is not startable yet.
    expect(isScheduledDeskRow({ daysUntilAvailable: 0 })).toBe(true);
    expect(isScheduledDeskRow({ daysUntilAvailable: null })).toBe(false);
  });
});

describe('compareRenewalDeskRows', () => {
  it('puts every actionable call above every previewed one', () => {
    /*
     * The load-bearing case. The preview renews sooner (14 days vs 80), so
     * ordering on `daysUntilRenewal` alone would float a call nobody can make
     * yet above one that is open.
     */
    const open = row({
      cycleId: 'open',
      daysUntilRenewal: 80,
      isActionable: true,
      daysUntilAvailable: null,
    });
    const preview = row({
      cycleId: 'preview',
      daysUntilRenewal: 14,
      isActionable: false,
      daysUntilAvailable: 3,
      status: 'waiting',
    });
    expect(order([preview, open])).toEqual(['open', 'preview']);
  });

  it('leads with overdue calls', () => {
    const overdue = row({
      cycleId: 'overdue',
      daysUntilRenewal: 40,
      isOverdue: true,
    });
    const onTime = row({ cycleId: 'onTime', daysUntilRenewal: 5 });
    expect(order([onTime, overdue])).toEqual(['overdue', 'onTime']);
  });

  it('orders the rest of the open calls by soonest renewal', () => {
    const far = row({ cycleId: 'far', daysUntilRenewal: 60 });
    const near = row({ cycleId: 'near', daysUntilRenewal: 7 });
    expect(order([far, near])).toEqual(['near', 'far']);
  });

  it('counts the previewed calls down by when they open', () => {
    const scheduled = (id: string, opensIn: number, renewalIn: number) =>
      row({
        cycleId: id,
        isActionable: false,
        status: 'waiting',
        daysUntilAvailable: opensIn,
        daysUntilRenewal: renewalIn,
      });
    // `later` renews sooner, so this also pins that opening order wins.
    expect(
      order([scheduled('later', 12, 20), scheduled('sooner', 1, 60)]),
    ).toEqual(['sooner', 'later']);
  });

  it('orders a full desk: overdue, open, then the countdown', () => {
    const rows = [
      row({
        cycleId: 'preview-late',
        isActionable: false,
        daysUntilAvailable: 11,
        status: 'waiting',
      }),
      row({ cycleId: 'open-far', daysUntilRenewal: 70 }),
      row({
        cycleId: 'preview-soon',
        isActionable: false,
        daysUntilAvailable: 2,
        status: 'waiting',
      }),
      row({ cycleId: 'overdue', daysUntilRenewal: 30, isOverdue: true }),
      row({ cycleId: 'open-near', daysUntilRenewal: 9 }),
    ];
    expect(order(rows)).toEqual([
      'overdue',
      'open-near',
      'open-far',
      'preview-soon',
      'preview-late',
    ]);
  });
});
