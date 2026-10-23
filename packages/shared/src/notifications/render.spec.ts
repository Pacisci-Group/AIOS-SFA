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
    'audit.sent_back': {
      dealId: '68f3c0ffee0000000000d31',
      dealAuditId: '68f3c0ffee0000000000d32',
      clientName: 'Daniel Lopez',
      reviewerName: 'Morgan Manager',
      note: 'The declarations page is for the wrong vehicle.',
      failedItemCount: 1,
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

  it('says who sent an audit back and why, and links to that deal', () => {
    const rendered = renderNotification(
      'audit.sent_back',
      FIXTURES['audit.sent_back'],
    );
    expect(rendered.body).toBe(
      "Morgan Manager sent back Daniel Lopez's audit: The declarations page is for the wrong vehicle.",
    );
    expect(rendered.href).toBe(
      '/dashboard/producer?audit=68f3c0ffee0000000000d31',
    );
  });

  it('falls back to the failed-item count when a send-back has no note', () => {
    const rendered = renderNotification('audit.sent_back', {
      failedItemCount: 2,
    });
    expect(rendered.body).toBe(
      'Your manager sent back an audit: 2 items need your attention.',
    );
    expect(rendered.href).toBe('/dashboard/producer');
  });

  it('names the reporter and the summary when both are present', () => {
    const rendered = renderNotification('bug_report.filed', FIXTURES['bug_report.filed']);
    expect(rendered.body).toBe(
      'Pat Producer: The leaderboard still shows last month',
    );
  });
});
