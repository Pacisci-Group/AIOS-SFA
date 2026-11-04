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

  it('names the reporter and the summary when both are present', () => {
    const rendered = renderNotification('bug_report.filed', FIXTURES['bug_report.filed']);
    expect(rendered.body).toBe(
      'Pat Producer: The leaderboard still shows last month',
    );
  });
});
