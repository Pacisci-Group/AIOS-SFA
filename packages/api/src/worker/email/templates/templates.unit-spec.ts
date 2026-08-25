import { EMAIL_TEMPLATES, type TemplateKey } from './registry';
import { inviteTemplate } from './invite.template';
import type { InviteRequestedData } from '../../../inngest/events';

/**
 * A payload with the awkward values a real agency will eventually supply: an
 * apostrophe in a person's name, and markup in a free-text field that reaches
 * us straight from the database.
 */
function inviteData(
  overrides: Partial<InviteRequestedData> = {},
): InviteRequestedData {
  return {
    // Stamped by `InngestService.send`, never by a producer. Present here only
    // because it is part of the event contract every payload carries.
    eventLogId: '507f1f77bcf86cd799439010',
    userId: '507f1f77bcf86cd799439011',
    agencyId: '507f1f77bcf86cd799439012',
    branchId: null,
    to: 'pat@example.com',
    recipientName: "Pat O'Brien",
    agencyName: 'Smith Family Agency',
    inviterName: 'Dana Owner',
    roleNames: ['Producer'],
    inviteUrl: 'https://app.example.com/auth/accept-invite?token=abc123',
    expiresAt: '2026-08-26T00:00:00.000Z',
    ...overrides,
  };
}

const ALL_KEYS = Object.keys(EMAIL_TEMPLATES) as TemplateKey[];

/**
 * Registry-wide invariants, asserted in a loop rather than per template.
 *
 * The point of the loop is that a *new* template inherits these checks without
 * anyone remembering to write them — which is the only way the "text part is
 * mandatory" rule survives the fifth template.
 */
describe('email template registry', () => {
  // Each template's representative payload. Adding a template without adding a
  // fixture fails here rather than silently skipping the invariants.
  const FIXTURES: Record<TemplateKey, unknown> = {
    invite: inviteData(),
  };

  it('has a fixture for every registered template', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(ALL_KEYS.sort());
  });

  describe.each(ALL_KEYS)('%s', (key) => {
    const template = EMAIL_TEMPLATES[key] as {
      key: string;
      subject: (d: unknown) => string;
      render: (d: unknown) => { html: string; text: string };
    };
    const data = FIXTURES[key];

    it('registry key matches the template key', () => {
      expect(template.key).toBe(key);
    });

    it('produces a non-empty subject', () => {
      expect(template.subject(data).trim().length).toBeGreaterThan(0);
    });

    // The one most likely to regress, and the one with a real cost: a message
    // with no text part is materially more likely to be filtered as spam.
    it('produces a non-empty text part', () => {
      expect(template.render(data).text.trim().length).toBeGreaterThan(0);
    });

    it('produces html wrapped in the shared layout', () => {
      const { html } = template.render(data);
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('AgencyOps');
    });
  });
});

describe('invite template', () => {
  it('carries the invite URL in both parts', () => {
    // The button is stripped or unclickable in some clients, so the raw URL has
    // to survive into the html as well as the text.
    const data = inviteData();
    const { html, text } = inviteTemplate.render(data);

    expect(text).toContain(data.inviteUrl);
    expect(html).toContain(data.inviteUrl);
  });

  it('names the inviter, the agency and the roles', () => {
    const { text } = inviteTemplate.render(inviteData());
    expect(text).toContain('Dana Owner');
    expect(text).toContain('Smith Family Agency');
    expect(text).toContain('Producer');
  });

  it('renders the expiry as a fixed-timezone calendar date', () => {
    // Pinned to UTC on purpose: the recipient's timezone is unknown, and a date
    // that shifts depending on which server rendered it is worse than one that
    // is consistently UTC.
    const { text } = inviteTemplate.render(
      inviteData({ expiresAt: '2026-08-26T23:30:00.000Z' }),
    );
    expect(text).toContain('August 26, 2026');
  });

  describe('untrusted values', () => {
    it('escapes markup in an agency name', () => {
      // Agency and person names come straight from the database and are
      // user-supplied. Markup in one must not survive into the recipient's
      // client.
      const { html } = inviteTemplate.render(
        inviteData({ agencyName: '<script>alert(1)</script>' }),
      );

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes an apostrophe without mangling the text part', () => {
      const { html, text } = inviteTemplate.render(inviteData());

      // Escaped in html so it cannot break out of an attribute...
      expect(html).toContain('Pat O&#39;Brien');
      // ...but plain in the text part, which is not markup.
      expect(text).toContain("Pat O'Brien");
    });
  });

  describe('missing optional values', () => {
    it('falls back rather than rendering "null" at the reader', () => {
      const { text } = inviteTemplate.render(
        inviteData({ recipientName: null, inviterName: null, roleNames: [] }),
      );

      expect(text).not.toContain('null');
      expect(text).toContain('Hi there,');
      expect(text).toContain('Someone has invited you');
      expect(text).toContain('no role yet');
    });

    it('still produces a usable subject with no inviter', () => {
      const subject = inviteTemplate.subject(inviteData({ inviterName: null }));
      expect(subject).toBe(
        'Someone invited you to Smith Family Agency on AgencyOps',
      );
    });
  });
});
