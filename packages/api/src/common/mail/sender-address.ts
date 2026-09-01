/**
 * How an agency's `From:` header is composed.
 *
 * A pure helper in `common/` rather than a method on a service, because **two
 * things on opposite sides of the worker boundary must agree on it**: the
 * worker's `SenderIdentityService` builds the header that actually goes out,
 * and the API's `AgencyEmailService` reports back to the owner which address
 * their mail is currently sending as. If those two ever disagreed, the settings
 * page would confidently display an address nothing sends from.
 *
 * `src/worker/` may import from `common/`; nothing may import from
 * `src/worker/` (see the note on `WorkerModule` — it is eslint-enforced). So
 * the shared rule has to live here. This is the same "extract the pure part"
 * split the codebase already makes between `intake.normalize.ts` and
 * `LeadIntakeService`.
 */

/** The stored email settings this helper needs. */
export interface SenderSettings {
  fromName?: string;
  fromLocalPart?: string;
  sendingDomain?: string;
  sendingStatus?: 'platform' | 'pending' | 'verified' | 'failed';
}

/**
 * Whether an agency may send from its own domain.
 *
 * The one rule that must never be optimistic. Resend rejects an unverified
 * `From:` with `invalid_from_address`, which `ResendTransport` treats as
 * **non-retriable** — so getting this wrong does not delay an email, it loses
 * it. `pending` and `failed` are both "no", and so is a `verified` domain that
 * is missing a local part, because `@texasholdings.com` is not an address.
 */
export function canSendFromOwnDomain(settings: SenderSettings): boolean {
  return (
    settings.sendingStatus === 'verified' &&
    !!settings.sendingDomain &&
    !!settings.fromLocalPart
  );
}

/**
 * The `From:` header for an agency.
 *
 * @param platformFrom The configured platform sender, which may be a full
 *   `Name <addr@host>` header — only its address is reused.
 */
export function buildFromHeader(
  settings: SenderSettings,
  displayName: string,
  platformFrom: string,
): string {
  const address = canSendFromOwnDomain(settings)
    ? `${settings.fromLocalPart}@${settings.sendingDomain}`
    : addressOf(platformFrom);

  return withDisplayName(displayName, address);
}

/**
 * Pull the bare address out of a `Name <addr@host>` header, or return the input
 * when it is already bare.
 *
 * `MAIL_DEFAULT_FROM` is configured as a full header, and we substitute the
 * agency's display name while keeping the address. Naively prefixing another
 * name would produce `Texas Holdings <AgencyOps <onboarding@…>>`, which the
 * provider rejects as a validation error — permanently.
 */
export function addressOf(header: string): string {
  const match = /<([^>]+)>/.exec(header);
  return (match?.[1] ?? header).trim();
}

/**
 * Build a quoted display name plus address.
 *
 * An agency name is user-supplied text being interpolated into a mail header,
 * so three classes of character are removed before quoting:
 *
 * - **`"` and `\`** — they terminate or escape their way out of the quoted
 *   string, which is what would turn one address into two.
 * - **CR and LF** — they start a *new header* entirely. This is the classic
 *   header-injection vector: a name containing `\r\nBcc: victim@…` would
 *   otherwise add a recipient.
 * - **`<` and `>`** — belt and braces. RFC 5322 permits both inside a quoted
 *   string, so a correct parser reads `"Evil <a@b>, X" <real@host>` as a single
 *   address with an odd display name. They are stripped anyway because the
 *   value crosses several parsers we do not control (the provider, relays, the
 *   recipient's client), and a header that *looks* like it carries two
 *   addresses is not worth defending on a technicality.
 */
export function withDisplayName(displayName: string, address: string): string {
  const safe = displayName.replace(/[\\"<>\r\n]/g, '').trim();
  return safe ? `"${safe}" <${address}>` : address;
}
