import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  buildFromHeader,
  type SenderSettings,
} from '../../common/mail/sender-address';
import { Agency, AgencyDocument } from '../../platform/schemas/agency.schema';

/** Last-resort sender when nothing is configured at all. */
const DEFAULT_FROM = 'AgencyOps <onboarding@resend.dev>';

export interface SenderIdentity {
  /** The full `From:` header value. */
  from: string;
  /** `Reply-To`, or `''` when none applies. */
  replyTo: string;
}

/**
 * Who an agency's email comes from.
 *
 * ## Two paths, and the default one asks nothing of the agency
 *
 * | `email.sendingStatus` | `From:` |
 * |---|---|
 * | `platform` (default) | our verified domain, **their** display name |
 * | `verified` | their own address |
 * | `pending` / `failed` | our verified domain — never theirs |
 *
 * The default path is the one that matters. `"Texas Holdings"
 * <notifications@ours>` already reads as the agency in every inbox, needs no
 * DNS work from them, and cannot damage deliverability. Setting `Reply-To` to
 * their address gets replies into their inbox with nothing else configured at
 * all. The custom sending domain is an upgrade, not a prerequisite.
 *
 * ## Never optimistic
 * `pending` and `failed` fall back to the platform address, and that is the
 * single most important line in this file. Sending `From:` an unverified domain
 * gets `invalid_from_address` back from Resend, which `ResendTransport` treats
 * as **non-retriable** — the run fails once and the invite is gone. An agency
 * mid-verification would otherwise lose every email it tried to send.
 *
 * ## Why this reads the database
 * The worker may run in its own container, so nothing on the event payload can
 * be trusted to carry the current sender — and the sender must reflect the
 * agency's settings at *send* time, not at enqueue time. This is a delivery
 * concern, not a template one: the purity rule in `template.types.ts` binds
 * templates, which still receive everything they need on the payload.
 */
@Injectable()
export class SenderIdentityService {
  private readonly logger = new Logger(SenderIdentityService.name);

  constructor(
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
    private readonly config: ConfigService,
  ) {}

  async resolve(agencyId: string | null | undefined): Promise<SenderIdentity> {
    const platformFrom =
      this.config.get<string>('MAIL_DEFAULT_FROM') ?? DEFAULT_FROM;
    const platformReplyTo = this.config.get<string>('MAIL_REPLY_TO') ?? '';

    if (!agencyId || !Types.ObjectId.isValid(agencyId)) {
      return { from: platformFrom, replyTo: platformReplyTo };
    }

    const agency = await this.agencyModel
      .findById(agencyId)
      .select('name branding email')
      .lean();

    if (!agency) {
      return { from: platformFrom, replyTo: platformReplyTo };
    }

    const settings = agency.email ?? {};
    const displayName = resolveDisplayName(agency, settings);
    const replyTo = settings.replyTo?.trim() || platformReplyTo;

    if (
      settings.sendingStatus === 'pending' ||
      settings.sendingStatus === 'failed'
    ) {
      // Worth a line in the logs: the owner believes they configured this, and
      // "why is mail still coming from your address?" is otherwise unanswerable
      // without reading the database.
      this.logger.debug(
        `Agency ${agencyId} has a ${settings.sendingStatus} sending domain; using the platform sender.`,
      );
    }

    return {
      // `buildFromHeader` is shared with the API's settings page so the address
      // shown there is provably the address that goes out — see its docblock.
      from: buildFromHeader(settings, displayName, platformFrom),
      replyTo,
    };
  }
}

/**
 * The name a recipient sees. Prefers an explicitly configured sender name, then
 * the white-label display name, then the agency's legal name — so an agency
 * that set a logo and a display name gets that name on its email without having
 * to configure anything twice.
 */
function resolveDisplayName(
  agency: { name: string; branding?: { displayName?: string } },
  settings: SenderSettings & { fromName?: string },
): string {
  return (
    settings.fromName?.trim() ||
    agency.branding?.displayName?.trim() ||
    agency.name
  );
}
