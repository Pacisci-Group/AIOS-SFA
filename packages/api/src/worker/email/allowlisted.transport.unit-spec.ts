import {
  AllowlistedMailTransport,
  parseRecipientAllowlist,
  recipientAllowed,
} from './allowlisted.transport';
import {
  MailTransport,
  type OutboundMessage,
  type SendResult,
} from './mail-transport';

class RecordingTransport extends MailTransport {
  readonly sent: string[] = [];
  send(message: OutboundMessage): Promise<SendResult> {
    this.sent.push(message.to);
    return Promise.resolve({ providerMessageId: `id-${this.sent.length}` });
  }
}

function message(to: string): OutboundMessage {
  return { to, from: 'x@y.z', subject: 's', html: '<p/>', text: 't' };
}

describe('parseRecipientAllowlist', () => {
  it('splits on commas, trims, lowercases and drops blanks', () => {
    expect(parseRecipientAllowlist(' Pat@Example.com, @Team.dev ,, ')).toEqual([
      'pat@example.com',
      '@team.dev',
    ]);
  });

  it('is empty for an unset or blank variable', () => {
    expect(parseRecipientAllowlist(undefined)).toEqual([]);
    expect(parseRecipientAllowlist('  ')).toEqual([]);
  });
});

describe('recipientAllowed', () => {
  const allowed = ['pat@example.com', '@team.dev'];

  it('matches an exact address, case-insensitively', () => {
    expect(recipientAllowed('PAT@example.com', allowed)).toBe(true);
    expect(recipientAllowed('sam@example.com', allowed)).toBe(false);
  });

  it('matches a domain suffix, and only as a suffix', () => {
    expect(recipientAllowed('anyone@team.dev', allowed)).toBe(true);
    expect(recipientAllowed('anyone@notteam.dev', allowed)).toBe(false);
    expect(recipientAllowed('anyone@team.dev.evil.com', allowed)).toBe(false);
  });

  it('allows nobody when the list is empty', () => {
    expect(recipientAllowed('pat@example.com', [])).toBe(false);
  });
});

describe('AllowlistedMailTransport', () => {
  it('sends listed recipients through the real transport and the rest through the fallback', async () => {
    const real = new RecordingTransport();
    const fallback = new RecordingTransport();
    const transport = new AllowlistedMailTransport(real, fallback, [
      '@team.dev',
    ]);

    await transport.send(message('dev@team.dev'), 'k1');
    await transport.send(message('owner@real-agency.com'), 'k2');

    expect(real.sent).toEqual(['dev@team.dev']);
    expect(fallback.sent).toEqual(['owner@real-agency.com']);
  });
});
