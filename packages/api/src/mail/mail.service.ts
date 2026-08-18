import { Injectable, Logger } from '@nestjs/common';
import { InviteEmailPayload } from './mail.types';

/**
 * The single seam every outbound email goes through.
 *
 * ## Status: delivery is NOT implemented (PAC-58 Scope 1 deferred)
 *
 * The provider and the overall email architecture are still undecided, so this
 * service currently **logs** what it would send instead of sending it. That is a
 * deliberate placeholder, not an oversight — the rest of the invite flow
 * (PAC-58 Scopes 2–4) is built against this interface so that landing a real
 * transport is a change to {@link deliver} alone.
 *
 * ### What "implement it later" means concretely
 * Replace the body of {@link deliver} with a provider call (Resend / SendGrid /
 * SES / SMTP), most likely by injecting a `MailTransport` interface so the
 * provider stays swappable and tests can assert against a fake. Nothing outside
 * this file needs to change: callers already `await` the send and let failures
 * propagate.
 *
 * ### Failure contract callers rely on
 * A send that fails **throws**. It is never swallowed. `UsersService.inviteUser`
 * creates the user *before* calling here, so a throw leaves a pending invite the
 * owner can resend from the users list rather than a half-created account — see
 * the note on that method.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  /**
   * Send the "you've been invited" email.
   *
   * The rendered link is logged at `log` level on purpose while delivery is
   * stubbed: taking the URL out of the API console is the only way to walk the
   * accept-invite flow locally. Once a real transport lands, drop the URL from
   * the log line — an invite token is a bearer credential and does not belong in
   * production logs.
   */
  async sendInviteEmail(payload: InviteEmailPayload): Promise<void> {
    const roles = payload.roleNames.join(', ') || 'no role';
    const inviter = payload.inviterName ?? 'Someone';

    await this.deliver({
      to: payload.to,
      subject: `${inviter} invited you to ${payload.agencyName} on AgencyOps`,
      body: [
        `Hi ${payload.recipientName ?? 'there'},`,
        '',
        `${inviter} has invited you to join ${payload.agencyName} as ${roles}.`,
        '',
        `Set your password: ${payload.inviteUrl}`,
        '',
        `This link expires on ${payload.expiresAt.toISOString()}.`,
      ].join('\n'),
    });
  }

  /**
   * The transport boundary. **Currently a no-op that logs.**
   *
   * This is the one method to replace when the email architecture is settled;
   * see the class docblock.
   */
  private deliver(message: {
    to: string;
    subject: string;
    body: string;
  }): Promise<void> {
    this.logger.log(
      `[MAIL NOT SENT — transport not implemented] to=${message.to} subject="${message.subject}"\n${message.body}`,
    );
    return Promise.resolve();
  }
}
