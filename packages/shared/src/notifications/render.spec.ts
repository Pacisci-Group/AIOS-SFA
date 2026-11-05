import { NOTIFICATION_TYPE_KEYS, NOTIFICATION_TYPES } from './catalog';
import { NotificationRenderError, renderNotification } from './render';

/**
 * A fixture per catalog type, so a type added without a renderer — or a
 * renderer whose `href` stops being a path — fails here rather than at the
 * first event the worker tries to deliver.
 */
const FIXTURES: Record<keyof typeof NOTIFICATION_TYPES, Record<string, unknown>> =
  {
    'bug_report.filed': {
      bugReportId: '68f3c0ffee0000000000c21',
      summary: 'The leaderboard still shows last month',
      severity: 'high',
      reporterName: 'Pat Producer',
      agencyId: null,
    },
    'time_off.submitted': { ...timeOff(), note: 'Family trip' },
    'time_off.changes_requested': { ...timeOff(), note: 'Can you move it a week?' },
    'time_off.approved': timeOff(),
    'time_off.auto_approved_notice': timeOff(),
    'time_off.declined': { ...timeOff(), note: 'Two people are already off' },
    'time_off.approval_cancelled': { ...timeOff(), cancelledBy: 'reviewer' },
    'time_off.recorded': timeOff(),
    'time_off.balance_adjusted': {
      policyName: 'Paid time off',
      hours: -8,
      reason: 'Correcting the March accrual',
      actorName: 'Taylor Nguyen',
    },
  };

/** The `data` every request notification carries (PAC-165). */
function timeOff(): Record<string, unknown> {
  return {
    requestId: '68f3c0ffee0000000000c210',
    reference: 'TOR-2026-007',
    employeeName: 'Pat Producer',
    actorName: 'Taylor Nguyen',
    policyName: 'Paid time off',
    firstDay: '2026-11-12',
    lastDay: '2026-11-14',
    totalHours: 24,
    note: null,
  };
}

describe('renderNotification', () => {
  it.each(NOTIFICATION_TYPE_KEYS)('renders %s to a title, body and path', (type) => {
    const rendered = renderNotification(type, FIXTURES[type]);
    expect(rendered.title.trim().length).toBeGreaterThan(0);
    expect(rendered.body.trim().length).toBeGreaterThan(0);
    expect(rendered.href).toMatch(/^\/(?!\/)/);
  });

  it('has a fixture for every catalog type', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...NOTIFICATION_TYPE_KEYS].sort());
  });

  it('rejects a type the catalog does not know', () => {
    expect(() => renderNotification('lead.teleported', {})).toThrow(
      NotificationRenderError,
    );
  });

  it('tolerates missing display fields rather than rendering "undefined"', () => {
    const rendered = renderNotification('bug_report.filed', {});
    expect(rendered.body).toBe('Someone filed a bug report.');
    expect(rendered.body).not.toContain('undefined');
  });

  it('names the reporter and the summary when both are present', () => {
    const rendered = renderNotification('bug_report.filed', FIXTURES['bug_report.filed']);
    expect(rendered.body).toBe(
      'Pat Producer: The leaderboard still shows last month',
    );
  });

  describe('time off (PAC-165)', () => {
    it('links to the request and names who, what and when', () => {
      const rendered = renderNotification('time_off.submitted', FIXTURES['time_off.submitted']);
      expect(rendered.href).toBe('/time-off/requests/68f3c0ffee0000000000c210');
      expect(rendered.title).toBe('Time off request to review');
      expect(rendered.body).toBe(
        'Pat Producer requested 24 h of Paid time off for Nov 12 – 14, 2026. “Family trip”',
      );
    });

    it('says a resubmission is one', () => {
      const rendered = renderNotification('time_off.submitted', {
        ...timeOff(),
        resubmitted: true,
      });
      expect(rendered.title).toBe('Time off request resent');
    });

    it('words an automatic approval without a reviewer', () => {
      const rendered = renderNotification('time_off.approved', {
        ...timeOff(),
        automatic: true,
      });
      expect(rendered.body).toBe(
        'Your Paid time off request for Nov 12 – 14, 2026 was approved automatically.',
      );
    });

    it('words a cancellation by who cancelled', () => {
      const byEmployee = renderNotification('time_off.approval_cancelled', {
        ...timeOff(),
        cancelledBy: 'employee',
      });
      expect(byEmployee.body).toBe(
        'Pat Producer cancelled their approved Paid time off leave for Nov 12 – 14, 2026.',
      );
      const byReviewer = renderNotification(
        'time_off.approval_cancelled',
        FIXTURES['time_off.approval_cancelled'],
      );
      expect(byReviewer.body).toContain('Taylor Nguyen cancelled your approved');
    });

    it('formats one day, a month boundary and a year boundary', () => {
      const body = (firstDay: string, lastDay: string) =>
        renderNotification('time_off.approved', { ...timeOff(), firstDay, lastDay }).body;
      expect(body('2026-11-12', '2026-11-12')).toContain('for Nov 12, 2026.');
      expect(body('2026-11-30', '2026-12-02')).toContain('for Nov 30 – Dec 2, 2026.');
      expect(body('2026-12-30', '2027-01-02')).toContain('for Dec 30, 2026 – Jan 2, 2027.');
    });

    it('says which way a balance moved', () => {
      const removed = renderNotification(
        'time_off.balance_adjusted',
        FIXTURES['time_off.balance_adjusted'],
      );
      expect(removed.body).toBe(
        'Taylor Nguyen removed 8 h from your Paid time off balance. “Correcting the March accrual”',
      );
      expect(removed.href).toBe('/time-off');
      const added = renderNotification('time_off.balance_adjusted', {
        policyName: 'Sick leave',
        hours: 4,
      });
      expect(added.body).toBe('An HR admin added 4 h to your Sick leave balance.');
    });

    it('falls back to the page, never a broken path, without a usable id', () => {
      for (const requestId of [undefined, '../admin', 'not-an-id']) {
        const rendered = renderNotification('time_off.declined', { requestId });
        expect(rendered.href).toBe('/time-off');
        expect(rendered.body).not.toContain('undefined');
      }
    });
  });
});
