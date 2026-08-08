import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ModuleKey,
  PublicLeadFormInfo,
  PublicLeadSubmitResponse,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { PublicCreateLeadDto } from '../leads/dto/create-lead.dto';
import { IntakeContext } from '../leads/intake/intake.types';
import { LeadIntakeService } from '../leads/intake/lead-intake.service';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ShareLink, ShareLinkDocument } from './schemas/share-link.schema';
import { isWellFormedShareLinkToken } from './share-link-token';

@Injectable()
export class PublicLeadsService {
  private readonly logger = new Logger(PublicLeadsService.name);

  constructor(
    @InjectModel(ShareLink.name)
    private readonly shareLinkModel: Model<ShareLinkDocument>,
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly intake: LeadIntakeService,
  ) {}

  /**
   * What the public form needs to render, and nothing else.
   *
   * The entire response is `{ agencyName, isActive }`. No producer identity, no
   * `agencyId`/`branchId`, no link id, no submission count, no lead source (a
   * share-link lead has none). Every field added here is visible to anyone on
   * the internet holding the URL.
   */
  async getFormInfo(token: string): Promise<PublicLeadFormInfo> {
    const { agency } = await this.resolveLink(token);
    return { agencyName: agency.name, isActive: true };
  }

  /**
   * Run the same intake pipeline as the authenticated form, with tenancy taken
   * exclusively from the link record.
   */
  async submit(
    token: string,
    dto: PublicCreateLeadDto,
  ): Promise<PublicLeadSubmitResponse> {
    const { link } = await this.resolveLink(token);

    const ctx: IntakeContext = {
      // Every one of these comes from the stored link. Nothing in `dto` can
      // influence them, and `LeadIntakeService` reads tenancy from nowhere else.
      agencyId: link.agencyId,
      branchId: link.branchId,
      producerId: link.producerId,
      channel: 'share_link',
      shareLinkId: link._id,
      // No lead source. A producer sets it afterwards; guessing one would record
      // an assumption as fact, and nothing later could tell it from a real answer.
      leadSource: null,
      actorUserId: null,
    };

    const outcome = await this.intake.process(ctx, {
      primaryContact: dto.primaryContact,
      address: dto.address,
      members: dto.members,
      policiesOfInterest: dto.policiesOfInterest,
      quoteControlNumber: dto.quoteControlNumber,
      submissionToken: dto.submissionToken,
    });

    // New leads only: a replayed submission (flaky mobile connection, retry)
    // must not inflate the count a producer uses to judge whether a link works.
    if (outcome.leadIsNew) {
      try {
        await this.shareLinkModel.updateOne(
          { _id: link._id },
          {
            $inc: { submissionCount: 1 },
            $set: { lastSubmissionAt: new Date() },
          },
        );
      } catch (error) {
        // Best-effort, post-commit. A counter is not worth failing a lead over.
        this.logger.error(
          `Failed to increment submissionCount for share link ${link._id.toString()}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    // No ids, ever — the submitter is an outsider and gets a plain confirmation.
    return { submitted: true };
  }

  /**
   * Resolve a token to its link and agency, or fail generically.
   *
   * Every rejection returns the *same* `NotFoundException`, so the response
   * cannot be used to learn whether a token ever existed, whether it was
   * revoked, or which agency it belonged to. The e2e suite asserts that an
   * unknown token and a revoked one are byte-for-byte identical.
   */
  private async resolveLink(token: string): Promise<{
    link: ShareLinkDocument;
    agency: AgencyDocument;
  }> {
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
  private unavailable(): NotFoundException {
    return new NotFoundException('This form is no longer available.');
  }
}
