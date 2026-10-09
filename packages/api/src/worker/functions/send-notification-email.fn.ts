import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { NonRetriableError } from 'inngest';
import type { Model } from 'mongoose';
import { TenantUrlService } from '../../common/tenancy/tenant-url.service';
import {
  notificationEmailRequested,
  type NotificationEmailRequestedData,
} from '../../inngest/events';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';
import {
  Notification,
  type NotificationChannelDeliverySubdoc,
  type NotificationDocument,
} from '../../notifications/schemas/notification.schema';
import { TenantBrandingService } from '../../tenant-branding/tenant-branding.service';
import { User, type UserDocument } from '../../users/schemas/user.schema';
import {
  MailDeliveryService,
  type SentEmail,
} from '../email/mail-delivery.service';
import type { NotificationEmailData } from '../email/templates/notification.template';

/**
 * What `load` hands the later steps. Plain JSON — a step result is serialised
 * and replayed, so there is no `ObjectId` or `Date` in here.
 */
type LoadResult =
  | {
      kind: 'ready';
      /** The row's agency — the mail's tenancy for `emailMessages` and `From:`. */
      agencyId: string | null;
      data: NotificationEmailData;
    }
  /** The row is gone; nothing to mail and nothing to record it on. */
  | { kind: 'missing' }
  /** A previous run already mailed it — the guard past Inngest's 24 h window. */
  | { kind: 'already-sent' }
  /** The recipient cannot be mailed; recorded on the row as `skipped`. */
  | { kind: 'skipped'; reason: string };

/**
 * Mail one stored notification to its recipient (PAC-154, PR3).
 *
 * The in-app row is written first and is the truth; this function renders the
 * **same** `title`/`body` into the generic `notification` template, with the
 * row's path made absolute on the recipient's tenant host. It is a separate
 * function from `DeliverNotificationFn` for the same reason the campaign commit
 * mails from one: a mail provider outage must never fail, or retry, a row that
 * is already stored and already live.
 *
 * ## The row never loses
 *
 * Whatever happens here only ever touches `delivery.email` (PAC-148 FR-H4).
 * A failed send is recorded there and rethrown so Inngest retries; the
 * title, body, `readAt` and the rest are never written by this function.
 *
 * ## Why `load` is a step that can write
 *
 * A recipient with no usable address is not an error worth four retries and a
 * red run — it is a fact about the row, recorded as `skipped` and done. That
 * write is idempotent, so it is safe inside a replayed step.
 *
 * ## Import boundary
 *
 * `*.schema.ts`, `common/` and `tenant-branding/` only — the last is not a
 * feature directory, and the service depends on nothing but the `Agency`
 * model, which the worker registers. See `eslint.config.mjs`.
 */
@Injectable()
@InngestFunction()
export class SendNotificationEmailFn implements InngestFunctionProvider {
  private readonly logger = new Logger(SendNotificationEmailFn.name);

  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    private readonly mail: MailDeliveryService,
    private readonly branding: TenantBrandingService,
    private readonly tenantUrls: TenantUrlService,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  build() {
    return this.inngest.createFunction(
      {
        id: 'send-notification-email',
        name: 'Send notification email',
        triggers: [notificationEmailRequested],
        /**
         * One row is mailed at most once in 24 hours, however many times the
         * `email` step upstream is replayed. Past that window the row's own
         * `delivery.email.status` is the guard (see `load`).
         */
        idempotency: 'event.data.notificationId',
        /** Same reasoning as the invite: enough to ride out a Resend blip. */
        retries: 4,
        /**
         * Resend's default account limit is 2 requests/second, and `throttle`
         * is what enforces it: at most `limit` runs *start* per `period`,
         * across every run of this function, the rest queue. `concurrency`
         * is a different knob — it caps runs in flight and says nothing about
         * rate — and was all this shipped with, so one bug report fanning out
         * to three admins could 429, burn a retry each and briefly write
         * `delivery.email: failed` on the rows (PR3 review).
         */
        throttle: { limit: 2, period: '1s' },
        /** Bounds worker slots. The rate is `throttle`'s job. */
        concurrency: { limit: 5 },
      },
      ({ event, step }) => this.handle(event, step),
    );
  }

  /** The handler body, lifted out so a test can drive it with a fake `step`. */
  async handle(
    event: { id?: string; name: string; data: NotificationEmailRequestedData },
    step: StepLike,
  ): Promise<{ sent: boolean; reason?: string; emailMessageId?: string }> {
    const { notificationId } = event.data;

    const loaded = (await step.run('load', () =>
      this.load(event.data),
    )) as LoadResult;

    if (loaded.kind !== 'ready') {
      const reason = loaded.kind === 'skipped' ? loaded.reason : loaded.kind;
      this.logger.log(`Not mailing notification ${notificationId}: ${reason}.`);
      return { sent: false, reason };
    }

    // Two steps, deliberately — the same split `SendInviteEmailFn` makes.
    // `step.run` memoizes on success, so a crash between them costs a
    // re-recorded row rather than a second email. The cast is sound because
    // `SentEmail` is entirely strings.
    const sent = (await step.run('send', () =>
      this.send(notificationId, loaded.data, loaded.agencyId),
    )) as SentEmail;

    const recorded = (await step.run('record', () =>
      this.record(
        {
          eventId: event.id ?? '',
          eventType: event.name,
          agencyId: loaded.agencyId,
          branchId: null,
        },
        notificationId,
        sent,
      ),
    )) as { emailMessageId: string };

    return { sent: true, emailMessageId: recorded.emailMessageId };
  }

  /**
   * Everything the template needs, read now rather than carried on the event.
   *
   * ## The row is the authority, the event only names it
   *
   * Who is mailed, and under which agency, is read from the **stored row** —
   * the event's `recipientId` and `agencyId` are checked against it and a
   * disagreement is a `NonRetriableError`. Today the only producer copies both
   * from the row, so they cannot differ; a mis-wired emit or a hand-edited
   * outbox replay could, and the failure mode would be notification X's title
   * and body in user B's inbox.
   *
   * ## Two hosts, deliberately
   *
   * The **link** is built on the *recipient's* host (`TenantUrlService` from
   * `User.agencyId`; `null` is a platform admin on the platform host).
   * `HostTenantGuard` binds a session to the host it was created on, so a link
   * has to land where the recipient can sign in — and that is a property of
   * the recipient, not of the row. A platform admin notified about an
   * agency-scoped row gets a platform-host link; an agency user always gets
   * their agency's. The **brand** is the *row's* agency, through
   * `emailBrandFor`, which puts the logo on that agency's own host or leaves
   * it out when there is none (AGENTS.md §11; PR3 review).
   */
  private async load(
    event: NotificationEmailRequestedData,
  ): Promise<LoadResult> {
    const { notificationId } = event;
    const row = await this.notificationModel.findById(notificationId).lean();
    if (!row) return { kind: 'missing' };
    if (row.delivery?.email?.status === 'sent') return { kind: 'already-sent' };

    const recipientId = row.recipientId.toHexString();
    const agencyId = row.agencyId ? row.agencyId.toHexString() : null;
    if (recipientId !== event.recipientId || agencyId !== event.agencyId) {
      throw new NonRetriableError(
        `Event for notification ${notificationId} names recipient ` +
          `${event.recipientId} / agency ${event.agencyId ?? 'null'}, but the ` +
          `row says ${recipientId} / ${agencyId ?? 'null'}. Not mailing.`,
      );
    }

    const user = await this.userModel
      .findById(recipientId)
      .select({ email: 1, firstName: 1, isActive: 1, agencyId: 1 })
      .lean();
    if (!user || !user.isActive || !user.email) {
      // Three reasons, kept apart: whoever reads `delivery.email.error` on
      // the row should learn what actually happened, and "deactivated" for
      // an active user with no address sends them down the wrong path.
      const reason = !user
        ? 'recipient not found'
        : !user.isActive
          ? 'recipient is deactivated'
          : 'recipient has no email address';
      await this.setEmailDelivery(notificationId, {
        status: 'skipped',
        at: new Date(),
        error: reason,
        emailMessageId: null,
      });
      return { kind: 'skipped', reason };
    }

    const [baseUrl, brand] = await Promise.all([
      this.tenantUrls.baseUrlFor(user.agencyId?.toHexString() ?? null),
      this.branding.emailBrandFor(agencyId),
    ]);

    return {
      kind: 'ready',
      agencyId,
      data: {
        to: user.email,
        recipientName: user.firstName?.trim() || null,
        title: row.title,
        body: row.body,
        href: `${baseUrl}${row.href}`,
        brand,
      },
    };
  }

  /**
   * Hand the mail to the provider; on failure, say so on the row and rethrow.
   *
   * The rethrow is what makes Inngest retry (and what a `NonRetriableError`
   * from the transport short-circuits). The write before it is why a row whose
   * mail never went out reads `failed` rather than nothing — and a later
   * successful attempt overwrites it with `sent`.
   */
  private async send(
    notificationId: string,
    data: NotificationEmailData,
    agencyId: string | null,
  ): Promise<SentEmail> {
    try {
      return await this.mail.send(
        'notification',
        data,
        `notification:${notificationId}`,
        agencyId,
      );
    } catch (err) {
      await this.setEmailDelivery(notificationId, {
        status: 'failed',
        at: new Date(),
        error: err instanceof Error ? err.message : String(err),
        emailMessageId: null,
      });
      throw err;
    }
  }

  private async record(
    context: {
      eventId: string;
      eventType: string;
      agencyId: string | null;
      branchId: null;
    },
    notificationId: string,
    sent: SentEmail,
  ): Promise<{ emailMessageId: string }> {
    const { emailMessageId } = await this.mail.record(context, sent);
    await this.setEmailDelivery(notificationId, {
      status: 'sent',
      at: new Date(),
      error: null,
      emailMessageId,
    });
    return { emailMessageId };
  }

  /** The one write this function makes to a notification row. */
  private async setEmailDelivery(
    notificationId: string,
    email: NotificationChannelDeliverySubdoc,
  ): Promise<void> {
    await this.notificationModel.updateOne(
      { _id: notificationId },
      { $set: { 'delivery.email': email } },
    );
  }
}

/** The slice of Inngest's step tooling this handler uses — the test seam. */
interface StepLike {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<unknown>;
}
