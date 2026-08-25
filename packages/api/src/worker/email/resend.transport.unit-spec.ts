import { NonRetriableError } from 'inngest';
import { Resend } from 'resend';
import { ResendTransport } from './resend.transport';
import type { OutboundMessage } from './mail-transport';

const message: OutboundMessage = {
  to: 'pat@example.com',
  from: 'AgencyOps <notifications@example.com>',
  subject: 'Test',
  html: '<p>Test</p>',
  text: 'Test',
};

/** The two arguments `ResendTransport` passes to `resend.emails.send`. */
type SendArgs = [Record<string, unknown>, { idempotencyKey: string }];

/** Build a transport whose Resend client returns a canned response. */
function transportReturning(response: unknown) {
  // Typed rather than a bare jest.fn(): the assertions below read
  // `send.mock.calls[0][0]`, and an untyped mock makes every one of those an
  // unchecked `any`.
  const send = jest
    .fn<Promise<unknown>, SendArgs>()
    .mockResolvedValue(response);
  const resend = { emails: { send } } as unknown as Resend;
  return { transport: new ResendTransport(resend), send };
}

/**
 * These tests exist because of one specific hazard: **the Resend SDK does not
 * throw on an API error.** It resolves with `{ data: null, error }`. An
 * `await` with no check therefore looks exactly like a successful send, and the
 * caller records a delivery that never happened. Every case below pins a branch
 * that guards against that.
 */
describe('ResendTransport', () => {
  describe('on success', () => {
    it('returns the provider message id', async () => {
      const { transport } = transportReturning({
        data: { id: 'resend-abc-123' },
        error: null,
      });

      await expect(transport.send(message, 'key-1')).resolves.toEqual({
        providerMessageId: 'resend-abc-123',
      });
    });

    it('passes the idempotency key through to Resend', async () => {
      // The second of three idempotency layers: it covers the case Inngest
      // cannot see — the request reached Resend but the response was lost, so
      // the step is retried having genuinely sent the mail.
      const { transport, send } = transportReturning({
        data: { id: 'resend-abc-123' },
        error: null,
      });

      await transport.send(message, 'invite-key');

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ to: message.to, text: message.text }),
        { idempotencyKey: 'invite-key' },
      );
    });

    it('omits replyTo entirely when it is not set', async () => {
      const { transport, send } = transportReturning({
        data: { id: 'x' },
        error: null,
      });

      await transport.send(message, 'k');

      expect(send.mock.calls[0][0]).not.toHaveProperty('replyTo');
    });
  });

  describe('on a permanent error', () => {
    // NonRetriableError is what stops Inngest spending four more attempts on a
    // condition that cannot improve.
    it.each([
      'validation_error',
      'invalid_from_address',
      'missing_required_field',
      'invalid_api_key',
    ])('throws NonRetriableError for %s', async (name) => {
      const { transport } = transportReturning({
        data: null,
        error: { name, message: 'nope', statusCode: 422 },
      });

      await expect(transport.send(message, 'k')).rejects.toBeInstanceOf(
        NonRetriableError,
      );
    });
  });

  describe('on a transient error', () => {
    // A plain throw is what makes Inngest retry with backoff. Getting this
    // wrong in the other direction silently drops a real email, which is why
    // anything unrecognised is treated as retryable.
    it.each([
      'rate_limit_exceeded',
      'internal_server_error',
      'application_error',
    ])('throws a plain Error for %s', async (name) => {
      const { transport } = transportReturning({
        data: null,
        error: { name, message: 'slow down', statusCode: 429 },
      });

      const send = transport.send(message, 'k');
      await expect(send).rejects.toThrow(/Resend send failed/);
      await expect(send).rejects.not.toBeInstanceOf(NonRetriableError);
    });

    it('treats an unrecognised error code as retryable', async () => {
      const { transport } = transportReturning({
        data: null,
        error: { name: 'some_future_code', message: '?', statusCode: 500 },
      });

      await expect(transport.send(message, 'k')).rejects.not.toBeInstanceOf(
        NonRetriableError,
      );
    });
  });

  describe('on a malformed success', () => {
    it('throws when Resend reports success with no message id', async () => {
      // Without an id the delivery webhook can never be matched back to this
      // row, so recording it would create a message we can never reconcile.
      const { transport } = transportReturning({ data: {}, error: null });

      await expect(transport.send(message, 'k')).rejects.toThrow(
        /no message id/,
      );
    });
  });
});
