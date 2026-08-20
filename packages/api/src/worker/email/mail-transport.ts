/** A fully rendered message, ready to hand to a provider. */
export interface OutboundMessage {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  /**
   * Plain-text alternative. **Required, not optional.** A message with no text
   * part is materially more likely to be filtered as spam, and making it
   * optional is how it silently goes missing on the fifth template.
   */
  text: string;
}

export interface SendResult {
  /** The provider's id for this message. Used to match delivery webhooks. */
  providerMessageId: string;
}

/**
 * The provider boundary.
 *
 * ## Failure contract
 * A failed send **throws**. It is never swallowed. This is the contract
 * `MailService`'s docblock has promised callers since before a transport
 * existed, moved here intact now that this is the code that owns it.
 *
 * Throwing is what makes Inngest retry, so the distinction matters:
 * - **Transient** (network, 5xx, 429): throw a normal error → Inngest retries
 *   with backoff.
 * - **Permanent** (malformed address, rejected payload): throw
 *   `NonRetriableError` → Inngest fails the run once instead of four more
 *   times against a condition that cannot improve.
 */
export abstract class MailTransport {
  /**
   * @param idempotencyKey Passed to the provider so a duplicate HTTP call —
   *   one Inngest cannot see, e.g. a retry after a response was lost in
   *   flight — collapses provider-side rather than sending twice.
   */
  abstract send(
    message: OutboundMessage,
    idempotencyKey: string,
  ): Promise<SendResult>;
}
