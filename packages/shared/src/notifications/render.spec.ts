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
    'reconciliation.row_assigned': {
      rowId: '6ae1bceaa8d09054f813c0f1',
      runId: '6ae1bceaa8d09054f813c0ea',
      policyNumber: '900200000',
      customerName: 'LISA TAYLOR',
      tabLabel: 'Premium differs',
      assignerName: 'Olive Owner',
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

  it('names the Dash policy and opens it on the assignee page', () => {
    const rendered = renderNotification(
      'reconciliation.row_assigned',
      FIXTURES['reconciliation.row_assigned'],
    );
    expect(rendered).toEqual({
      title: 'Dash policy assigned to you',
      body: '900200000 · LISA TAYLOR · Premium differs',
      href: '/reconciliation/assigned?row=6ae1bceaa8d09054f813c0f1',
    });
  });

  it('falls back to the assignee page when the row is missing or not an id', () => {
    for (const data of [{}, { rowId: '../../admin' }]) {
      const rendered = renderNotification('reconciliation.row_assigned', data);
      expect(rendered.href).toBe('/reconciliation/assigned');
      expect(rendered.body).toBe('A line from the Dash report needs you.');
    }
  });
});
