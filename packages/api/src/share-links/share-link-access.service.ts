import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ModuleKey } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ShareLink, ShareLinkDocument } from './schemas/share-link.schema';
import { isWellFormedShareLinkToken } from './share-link-token';

export interface ResolvedShareLink {
  link: ShareLinkDocument;
  agency: AgencyDocument;
}

/**
 * The one place a public share-link token is turned into a link + agency.
 *
 * Extracted from `PublicLeadsService` when PAC-60 added a second public
 * surface (address autocomplete on the intake form). The extraction is the
 * point: `@Public()` bypasses all six global guards, so every check the guard
 * chain would have made has to be repeated by hand here — and the
 * non-disclosure property below only holds if there is exactly one
 * implementation of them. A second, hand-copied version would drift, and the
 * way it would drift is by becoming more helpful.
 */
@Injectable()
export class ShareLinkAccessService {
  constructor(
    @InjectModel(ShareLink.name)
    private readonly shareLinkModel: Model<ShareLinkDocument>,
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * Resolve a token to its link and agency, or fail generically.
   *
   * Every rejection returns the *same* `NotFoundException`, so the response
   * cannot be used to learn whether a token ever existed, whether it was
   * revoked, or which agency it belonged to. The e2e suite asserts that an
   * unknown token and a revoked one are byte-for-byte identical.
   */
  async resolve(token: string): Promise<ResolvedShareLink> {
    if (!isWellFormedShareLinkToken(token)) throw this.unavailable();

    const link = await this.shareLinkModel.findOne({ token });
    if (!link || !link.isActive) throw this.unavailable();

    // `ShareLink.agencyId` is a string (TenantRecord) while `Agency._id` is an
    // ObjectId — the boundary where the two conventions meet.
    if (!Types.ObjectId.isValid(link.agencyId)) throw this.unavailable();

    const agency = await this.agencyModel.findById(
      new Types.ObjectId(link.agencyId),
    );
    if (!agency || agency.status !== 'active') throw this.unavailable();

    // `@Public()` skips ModuleGuard entirely, so the module entitlement has to
    // be checked by hand. Disabling `leads` for an agency must also close its
    // public forms.
    if (!agency.modules?.[ModuleKey.Leads]?.enabled) throw this.unavailable();

    // Not in the ticket, and deliberate: with round-robin out of scope there is
    // no fallback producer, so a departed producer's link would keep stamping
    // leads onto an inactive user where nobody would work them. Failing closed
    // keeps "the context always names a valid producer" true.
    const producerIsActive = await this.userModel.exists({
      _id: link.producerId,
      isActive: true,
    });
    if (!producerIsActive) throw this.unavailable();

    return { link, agency };
  }

  /** One message for every failure mode. Do not specialise it. */
  unavailable(): NotFoundException {
    return new NotFoundException('This form is no longer available.');
  }
}
