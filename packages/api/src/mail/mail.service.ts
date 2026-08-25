import { Injectable } from '@nestjs/common';
import { InngestService } from '../inngest/inngest.service';
import { inviteRequested } from '../inngest/events';
import { InviteEmailPayload } from './mail.types';

/**
 * The single seam every outbound email goes through.
 *
 * ## What this now does
 * It **emits an event**; it does not send. Rendering, the provider call and the
 * delivery record all happen in `src/worker/mail/`, driven by Inngest. That is
 * what buys retries with backoff, a dead-letter view, one-click replay, and
 * per-function rate limiting without any of it being written here.
 *
 * The class kept its name, location and method signature deliberately, exactly
 * as the previous docblock promised: *"Nothing outside this file needs to
 * change: callers already `await` the send and let failures propagate."*
 *
 * ## Failure contract callers rely on — unchanged
 * A failure **throws**. It is never swallowed. `UsersService.inviteUser` creates
 * the user *before* calling here, so a throw leaves a pending invite the owner
 * can resend rather than a half-created account.
 *
 * ## What did change, and it matters
 * The throw now means *"the event was not accepted"*, not *"the message was not
 * delivered"*. A resolved promise means the send **will** happen, not that it
 * has. So a bad address no longer surfaces synchronously to the owner — it
 * surfaces as a failed run and a `failed` row in `emailMessages`. Until the
 * users list reads that status back, a bounced invite is invisible in the UI.
 * That is a known gap, not an oversight; it is why `exposeInviteToken()` in
 * `UsersService` is deliberately still in place.
 */
@Injectable()
export class MailService {
  constructor(private readonly inngest: InngestService) {}

  /** Request the "you've been invited" email. */
  async sendInviteEmail(payload: InviteEmailPayload): Promise<void> {
    await this.deliver(payload);
  }

  /**
   * The transport boundary.
   *
   * Still the one method to replace if the async architecture ever changes —
   * the shape the previous stub established has been kept for exactly that
   * reason.
   */
  private async deliver(payload: InviteEmailPayload): Promise<void> {
    await this.inngest.send(inviteRequested, {
      userId: payload.userId,
      agencyId: payload.agencyId,
      branchId: payload.branchId,
      to: payload.to,
      recipientName: payload.recipientName,
      agencyName: payload.agencyName,
      inviterName: payload.inviterName,
      roleNames: payload.roleNames,
      inviteUrl: payload.inviteUrl,
      // The catalog carries instants as ISO strings, never `Date` — Inngest
      // rejects schemas with transforms, and an event is JSON on the wire
      // regardless. See `inngest/events/email.events.ts`.
      expiresAt: payload.expiresAt.toISOString(),
    });
  }
}
