import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { mailerControlNumberKey } from '@sfa/shared';
import { Model } from 'mongoose';
import { Mailer, MailerDocument } from '../../mailers/schemas/mailer.schema';
import { Lead, LeadDocument } from '../schemas/lead.schema';

/**
 * What a typed control number resolved to.
 *
 * `mailerId: null` with a key set is the **pending** state: the number is
 * well-formed and worth remembering, but no mailer answers to it yet. The
 * campaign commit's reconcile step walks exactly these leads.
 */
export interface ResolvedMailerLink {
  mailerId: MailerDocument['_id'] | null;
  campaignId: string | null;
  /** The normalized key. Always present — that is the point of the type. */
  key: string;
}

/**
 * Resolve a control number a *submitter* typed into a real mailer link
 * (PAC-71, attribution write path 2).
 *
 * ## Why this is not `MailersService`
 *
 * The intake pipeline runs on the public share-link route as well as the
 * authenticated one, and `MailersService` depends on `TenantContextResolver`
 * and `LeadIntakeService` — importing it here would be a cycle and would drag
 * request-scoped tenancy into a pipeline whose whole safety property is that it
 * reads tenancy from `IntakeContext` and nowhere else. This provider owns one
 * query and holds one model.
 *
 * ## What it deliberately does not do
 *
 * It never throws, and it never refuses to create a lead. A producer typing a
 * number that belongs to another agency's lead still gets their lead — they just
 * get it **without** the mailer link, carrying the key alone. The 409 in
 * `MailersService.logLead` is for the drawer, where the producer explicitly
 * asked for *that mailer*; here the mailer is a detail on a lead that exists
 * regardless, and failing the whole intake over it would lose a real enquiry.
 */
@Injectable()
export class MailerLinkResolver {
  constructor(
    @InjectModel(Mailer.name)
    private readonly mailerModel: Model<MailerDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
  ) {}

  /**
   * `null` when the input does not normalize to a key at all — there is nothing
   * worth storing and nothing for reconcile to pick up later.
   */
  async resolve(
    rawControlNumber: string,
    agencyId: string,
  ): Promise<ResolvedMailerLink | null> {
    const key = mailerControlNumberKey(rawControlNumber);
    if (!key) return null;

    // ⚠ `{ $type: 'null' }`, never `visibleAgencyIds: null` — a bare `null` also
    // matches a *missing* field. See the note on `Mailer.visibleAgencyIds`.
    const mailer = await this.mailerModel
      .findOne({
        controlNumberKeys: key,
        $or: [
          { visibleAgencyIds: { $type: 'null' } },
          { visibleAgencyIds: agencyId },
        ],
      })
      .select({ campaignId: 1 })
      .lean();

    if (!mailer) return { mailerId: null, campaignId: null, key };

    // One lead per mailer, platform-wide. If someone already owns it, downgrade
    // to key-only rather than producing a link the unique index would reject.
    const owned = await this.leadModel
      .exists({ 'mailer.mailerId': mailer._id })
      .then(Boolean);
    if (owned) return { mailerId: null, campaignId: null, key };

    return {
      mailerId: mailer._id,
      campaignId: mailer.campaignId,
      key,
    };
  }
}
