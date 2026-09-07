import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { mailerOutputLinkTtlSeconds } from '../../config/mailer-output.config';
import {
  mailerCampaignOutputEmailRequested,
  type MailerCampaignOutputEmailData,
} from '../../inngest/events';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';
import { TenantUrlService } from '../../common/tenancy/tenant-url.service';
import {
  MailerCampaign,
  type MailerCampaignDocument,
} from '../../mailers/schemas/mailer-campaign.schema';
import { StorageService } from '../../storage/storage.service';
import {
  MailDeliveryService,
  type SentEmail,
} from '../email/mail-delivery.service';
import type { MailerCampaignOutputData } from '../email/templates/mailer-campaign-output.template';
import type { StepLike } from './mailer-campaign.support';

/**
 * Everything the mail needs about the campaign, minus the link.
 *
 * ⚠ The presigned URL is deliberately **not** here. This is a `step.run` result,
 * which Inngest serialises and replays on every retry, and the URL is a bearer
 * capability: the file is fetchable by whoever holds it. It is minted inside
 * each send step instead, so it exists only for the duration of that send and
 * never lands in the run's stored state.
 */
interface CampaignBrief {
  outputKey: string;
  campaignName: string;
  campaignNumber: string | null;
  year: number | null;
  fileName: string;
  outputRows: number;
  recordCount: number;
  detailUrl: string;
}

/**
 * Mail the completion notice for a committed campaign (PAC-71).
 *
 * A **separate function** from the commit, not a step of it: an import that
 * wrote 20,000 mailers must not be reported as failed because a mail provider
 * was down. The commit emits this event through the outbox as its last act, and
 * the operator's `POST /platform/mailer-campaigns/:id/email` emits the same
 * event — one path, so a re-send is not a second implementation.
 *
 * ## Why there is no function-level `idempotency`
 *
 * The invite and reset functions key theirs on the URL, because the URL carries
 * the token that makes one invite distinct from another. The distinguishing
 * thing here is the *(campaign, attempt, recipient)* triple, and the natural
 * coarser key — campaign plus attempt — would silently swallow the operator's
 * real recovery: "the printer never got it, send it to this other address too."
 * Deduplication happens one level down instead, on the provider's
 * `Idempotency-Key`, at exactly the grain that is correct: the same recipient
 * for the same run is collapsed, a new recipient is not.
 *
 * ## Import boundary
 *
 * `*.schema.ts` and `common/` only — no feature service. See `eslint.config.mjs`.
 */
@Injectable()
@InngestFunction()
export class MailerCampaignOutputEmailFn implements InngestFunctionProvider {
  private readonly logger = new Logger(MailerCampaignOutputEmailFn.name);

  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    private readonly mail: MailDeliveryService,
    private readonly storage: StorageService,
    private readonly tenantUrls: TenantUrlService,
    private readonly config: ConfigService,
    @InjectModel(MailerCampaign.name)
    private readonly campaignModel: Model<MailerCampaignDocument>,
  ) {}

  build() {
    return this.inngest.createFunction(
      {
        id: 'mailer-campaign-output-email',
        name: 'Email a mailer campaign output',
        triggers: [mailerCampaignOutputEmailRequested],
        /** Same reasoning as the invite: enough to ride out a Resend blip. */
        retries: 4,
        /** Resend's default account limit is 2 requests/second. */
        concurrency: { limit: 5 },
      },
      ({ event, step }) => this.handle(event, step),
    );
  }

  /** The handler body, lifted out so a test can drive it with a fake `step`. */
  async handle(
    event: { id?: string; name: string; data: MailerCampaignOutputEmailData },
    step: StepLike,
  ): Promise<{ sent: number }> {
    const { campaignId, attempt, recipients } = event.data;

    const brief = (await step.run('load', () =>
      this.load(campaignId),
    )) as CampaignBrief | null;

    // Nothing to mail is a **no-op, never a failure**: a campaign deleted or
    // re-run between the commit and this job is not an error worth four retries
    // and a red run in the dashboard.
    if (!brief) {
      this.logger.log(
        `Skipping the output email for ${campaignId}: no imported output file.`,
      );
      return { sent: 0 };
    }

    let sent = 0;
    for (const [index, recipient] of recipients.entries()) {
      // Two steps per recipient, deliberately. `step.run` memoizes on success,
      // so a crash between them costs a re-recorded row rather than a second
      // email — the same split `SendInviteEmailFn` makes, and the reason a
      // partial failure over five recipients resumes at the one that threw
      // instead of mailing the first four again.
      //
      // The cast is sound for the same reason it is there: a step result is
      // serialised to JSON and back, so Inngest types `step.run` as returning
      // `Jsonify<T>`, and `SentEmail` is entirely strings.
      const delivered = (await step.run(`send:${index}`, () =>
        this.send(brief, recipient, campaignId, attempt),
      )) as SentEmail;

      await step.run(`record:${index}`, () =>
        this.mail.record(
          {
            eventId: event.id ?? '',
            eventType: event.name,
            // Platform mail: a campaign belongs to no tenant. This is the first
            // template for which that is true, and why the field is nullable.
            agencyId: null,
            branchId: null,
          },
          delivered,
        ),
      );
      sent += 1;
    }

    return { sent };
  }

  /**
   * What the mail says, read at send time rather than carried on the event.
   *
   * The event carries ids only (see `mailer.events.ts`), and the numbers must
   * describe the campaign as it stands now: an operator re-sending after a
   * second commit should get the second run's counts, not the first's.
   */
  private async load(campaignId: string): Promise<CampaignBrief | null> {
    const campaign = await this.campaignModel.findById(campaignId).lean();
    if (!campaign?.outputFile || campaign.status !== 'imported') return null;

    const counts = campaign.importCounts;
    return {
      outputKey: campaign.outputFile.storageKey,
      campaignName: campaign.name,
      campaignNumber: campaign.campaignNumber ?? null,
      year: campaign.year ?? null,
      fileName: campaign.outputFile.name,
      // `stats` is null for a `processed` source — nothing was transformed, so
      // there are no transform stats — and the import's own read count is then
      // the honest row number.
      outputRows: campaign.stats?.outputRows ?? counts?.read ?? 0,
      recordCount: (counts?.created ?? 0) + (counts?.updated ?? 0),
      detailUrl: `${this.tenantUrls.platformBaseUrl()}/admin/campaigns/${campaignId}`,
    };
  }

  /**
   * Mint the download link and hand the mail to the provider.
   *
   * The link is signed here, per recipient, so it never enters a memoized step
   * result — and `disposition: 'attachment'` with the stored filename means the
   * printer saves `SFA-QBP.csv` rather than a UUID-prefixed object key.
   *
   * The idempotency key is the *(campaign, attempt, recipient)* triple, which is
   * what makes a duplicate event or a re-send to the same address collapse at
   * the provider while a genuine send to a **new** address still goes out.
   */
  private async send(
    brief: CampaignBrief,
    recipient: string,
    campaignId: string,
    attempt: number,
  ): Promise<SentEmail> {
    const ttl = mailerOutputLinkTtlSeconds(
      this.config.get<string>('MAILER_OUTPUT_LINK_TTL_SECONDS'),
    );
    const downloadUrl = await this.storage.createPresignedDownload(
      brief.outputKey,
      {
        disposition: 'attachment',
        filename: brief.fileName,
        expiresIn: ttl,
      },
    );

    const data: MailerCampaignOutputData = {
      to: recipient,
      campaignName: brief.campaignName,
      campaignNumber: brief.campaignNumber,
      year: brief.year,
      fileName: brief.fileName,
      outputRows: brief.outputRows,
      recordCount: brief.recordCount,
      downloadUrl,
      downloadExpiresAt: new Date(Date.now() + ttl * 1_000).toISOString(),
      detailUrl: brief.detailUrl,
    };

    return this.mail.send(
      'mailerCampaignOutput',
      data,
      `mailer-campaign:${campaignId}:${attempt}:${recipient}`,
      // Platform mail — the `From:` is ours, not some agency's.
      null,
    );
  }
}
