import { Logger } from '@nestjs/common';
import { LoggingMailTransport } from './logging.transport';

const message = {
  to: 'pat@example.com',
  from: 'AgencyOps <x@y.z>',
  subject: 'Hello',
  html: '<p/>',
  text: 'Hello',
};

describe('LoggingMailTransport', () => {
  const lines: string[] = [];
  let log: jest.SpyInstance;

  beforeEach(() => {
    lines.length = 0;
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((entry: unknown) => {
        lines.push(String(entry));
      });
  });

  afterEach(() => {
    log.mockRestore();
  });

  it('names the missing key by default', async () => {
    const result = await new LoggingMailTransport().send(message, 'k');

    expect(lines[0]).toContain('MAIL NOT SENT — no RESEND_API_KEY');
    expect(result.providerMessageId).toMatch(/^local-/);
  });

  it('names the reason it was given, so a dev allowlist miss never reads as a missing key', async () => {
    await new LoggingMailTransport(
      'recipient not on MAIL_DEV_ALLOWED_RECIPIENTS',
    ).send(message, 'k');

    expect(lines[0]).toContain(
      'MAIL NOT SENT — recipient not on MAIL_DEV_ALLOWED_RECIPIENTS',
    );
    expect(lines[0]).not.toContain('no RESEND_API_KEY');
  });
});
