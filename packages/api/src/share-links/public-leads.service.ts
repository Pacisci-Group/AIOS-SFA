import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PublicLeadFormInfo, PublicLeadSubmitResponse } from '@sfa/shared';
import { Model } from 'mongoose';
import { PublicCreateLeadDto } from '../leads/dto/create-lead.dto';
import { IntakeContext } from '../leads/intake/intake.types';
import { LeadIntakeService } from '../leads/intake/lead-intake.service';
import { ShareLink, ShareLinkDocument } from './schemas/share-link.schema';
import { ShareLinkAccessService } from './share-link-access.service';

@Injectable()
export class PublicLeadsService {
  private readonly logger = new Logger(PublicLeadsService.name);

  constructor(
    @InjectModel(ShareLink.name)
    private readonly shareLinkModel: Model<ShareLinkDocument>,
    private readonly intake: LeadIntakeService,
    private readonly shareLinkAccess: ShareLinkAccessService,
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
    const { agency } = await this.shareLinkAccess.resolve(token);
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
    const { link } = await this.shareLinkAccess.resolve(token);

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
}
