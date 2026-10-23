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
    'hr.holidays_proposed': {
      agencyId: '68f3c0ffee0000000000c22',
      year: 2027,
      count: 11,
      countryName: 'United States',
      regionName: 'Oklahoma',
    },
    'hr.onboarding_pending': {
      userId: '68f3c0ffee0000000000c23',
      employeeName: 'Sam Seller',
      email: 'sam@example.com',
      branchName: 'Main',
      roleNames: ['Producer'],
    },
  };

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

  it('deep-links a holiday proposal to its year and counts the suggestions', () => {
    const rendered = renderNotification(
      'hr.holidays_proposed',
      FIXTURES['hr.holidays_proposed'],
    );
    expect(rendered.title).toBe("2027's holidays are ready to confirm");
    expect(rendered.body).toBe(
      '11 suggested holidays for 2027 from United States, Oklahoma. Review and confirm them in HR settings.',
    );
    expect(rendered.href).toBe('/settings/hr?tab=calendar&proposal=2027');
  });

  it('deep-links a pending onboarding to the person and names their branch and role', () => {
    const rendered = renderNotification(
      'hr.onboarding_pending',
      FIXTURES['hr.onboarding_pending'],
    );
    expect(rendered.title).toBe('Sam Seller needs HR onboarding');
    expect(rendered.body).toBe(
      'Sam Seller (Producer) was invited in Main without a leave policy. Pick their policy, schedule and start date to activate them.',
    );
    expect(rendered.href).toBe('/hr/onboardings?user=68f3c0ffee0000000000c23');
  });

  it('falls back to the email, then a generic name, for a pending onboarding', () => {
    expect(
      renderNotification('hr.onboarding_pending', { email: 'x@y.z' }).title,
    ).toBe('x@y.z needs HR onboarding');
    expect(renderNotification('hr.onboarding_pending', {}).href).toBe(
      '/hr/onboardings',
    );
  });

  it('names the reporter and the summary when both are present', () => {
    const rendered = renderNotification('bug_report.filed', FIXTURES['bug_report.filed']);
    expect(rendered.body).toBe(
      'Pat Producer: The leaderboard still shows last month',
    );
  });
});
