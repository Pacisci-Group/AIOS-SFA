import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { allowsPolicyTransfer } from '@sfa/shared';
import type { AccessContext, SoldDocumentPresignResponse } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { AuditGenerationService } from '../audit-generation/audit-generation.service';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import {
  Household,
  HouseholdDocument,
} from '../households/schemas/household.schema';
import { Policy, PolicyDocument } from '../policies/schemas/policy.schema';
import { StorageService } from '../storage/storage.service';
import type { SoldIntakeDto } from '../sold-deals/dto/create-sold-deal.dto';
import {
  transferDocumentPurpose,
  type PresignTransferDocumentDto,
} from '../sold-deals/dto/presign-sold-document.dto';
import { SoldDealIntakeService } from '../sold-deals/intake/sold-deal-intake.service';
import { SoldSubmissionValidator } from '../sold-deals/intake/sold-submission.validator';
import type { SoldIntakeContext } from '../sold-deals/intake/sold-intake.types';
import { User, UserDocument } from '../users/schemas/user.schema';
import type { CreatePolicyTransferDto } from './dto/policy-transfer.dto';
import {
  ServiceTicket,
  ServiceTicketDocument,
} from './schemas/service-ticket.schema';

/**
 * Recording a client's move from one package to another.
 *
 * A transfer is **the Sold pipeline with a different anchor and a different
 * label**: the same policy rows, the same documents, the same discount-driven
 * audit checklist — but no lead, no quote, and booked as `company_transfer` so
 * it never counts as new business. That reuse is deliberate; the information a
 * policy needs to exist does not change because nobody sold anything.
 *
 * Three things this owns that the sold path does not:
 *   - the **ticket** is the anchor and the scope clamp (a CSR has no lead to
 *     be clamped by, and `crm_service` scope on the ticket is the real check);
 *   - prior insurance is **injected as "none"** rather than asked for — the
 *     policy being replaced is already in our own book;
 *   - the household's active-policy count is recomputed, because a transfer
 *     retires one policy and activates another in the same breath.
 */
@Injectable()
export class PolicyTransfersService {
  private readonly logger = new Logger(PolicyTransfersService.name);

  constructor(
    @InjectModel(ServiceTicket.name)
    private readonly ticketModel: Model<ServiceTicketDocument>,
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    @InjectModel(Policy.name)
    private readonly policyModel: Model<PolicyDocument>,
    @InjectModel(Household.name)
    private readonly householdModel: Model<HouseholdDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly storage: StorageService,
    private readonly intake: SoldDealIntakeService,
    private readonly submissions: SoldSubmissionValidator,
    private readonly auditGeneration: AuditGenerationService,
  ) {}

  /**
   * A presigned PUT for a document on an in-progress transfer.
   *
   * Household-anchored, because the wizard uploads while it is still being
   * filled in and there is no deal yet — the same reasoning as the sold and
   * quote-recap presigns, one anchor along.
   */
  async presign(
    ticket: ServiceTicketDocument,
    dto: PresignTransferDocumentDto,
  ): Promise<SoldDocumentPresignResponse> {
    const householdId = this.requireHousehold(ticket);
    const key = this.storage.buildObjectKey({
      agencyId: String(ticket.agencyId),
      purpose: transferDocumentPurpose(householdId, dto.kind),
      filename: dto.filename,
    });
    const presigned = await this.storage.createPresignedUpload(
      key,
      dto.contentType,
    );
    return {
      key: presigned.key,
      uploadUrl: presigned.uploadUrl,
      requiredHeaders: presigned.requiredHeaders,
      expiresIn: presigned.expiresIn,
    };
  }

  /** Book the transfer. Returns the deal id; the caller re-serializes the ticket. */
  async record(
    access: AccessContext,
    ticket: ServiceTicketDocument,
    dto: CreatePolicyTransferDto,
  ): Promise<Types.ObjectId> {
    if (!allowsPolicyTransfer(ticket.category)) {
      throw new BadRequestException(
        `A policy transfer cannot be recorded from a ${ticket.category} ticket.`,
      );
    }
    const householdId = this.requireHousehold(ticket);
    const agencyId = String(ticket.agencyId);

    // One transfer per ticket. The unique index is the real guard — this is the
    // friendly error, and the race still lands on E11000 below.
    const existing = await this.dealModel
      .findOne({ agencyId, ticketId: ticket._id })
      .select('_id');
    if (existing) {
      throw new ConflictException(
        'A policy transfer has already been recorded on this ticket.',
      );
    }

    /*
     * Prior insurance and cancellation are injected, not asked for.
     *
     * `{ none: true }` + `{ cancelled: false }` is the only wire-legal "no
     * prior insurance" shape — the sold DTO actively rejects the contradiction
     * of `none` with a cancellation — and `PriorInsuranceStep` early-returns
     * when every row says so, writing nothing. That early return is the
     * documented "new-to-market client" path, reused here rather than special
     * cased.
     */
    const intakeDto: SoldIntakeDto = {
      soldDate: dto.transferDate,
      submissionToken: dto.submissionToken,
      policies: dto.policies.map((row) => ({
        ...row,
        priorInsurance: { none: true },
        cancellation: { cancelled: false },
      })),
    };

    await this.submissions.assertPolicyNumberFormats(intakeDto, agencyId);
    await this.submissions.verifyAttachments(intakeDto, agencyId, (kind) =>
      transferDocumentPurpose(householdId, kind),
    );

    const ctx: SoldIntakeContext = {
      agencyId,
      branchId: String(ticket.branchId ?? ''),
      // The CSR who recorded it. Under `own` data scope this is also what puts
      // the transfer on their own figures; the producer leaderboard excludes
      // transfers outright so it cannot rank them.
      producerId: new Types.ObjectId(access.userId),
      ticketId: ticket._id,
      businessType: 'company_transfer',
      householdId: new Types.ObjectId(householdId),
      clientName: ticket.clientName,
      submissionToken: dto.submissionToken
        ? `XFER|${dto.submissionToken.toUpperCase()}`
        : null,
    };

    // No lead source: a transfer did not come from anywhere, it was already
    // ours. `resolveLeadSource` renders `undefined` as the empty source.
    const outcome = await this.intake.process(
      ctx,
      intakeDto,
      access,
      undefined,
    );

    /*
     * Post-commit and best-effort, exactly as on the sold path — the transfer is
     * booked either way, and failing the request now would tell a CSR their work
     * did not happen when it did.
     */
    await this.auditGeneration.generateForDeal({
      agencyId,
      branchId: ctx.branchId,
      dealId: outcome.dealId,
      producerId: ctx.producerId,
      producerName: await this.actorName(access.userId),
      clientName: ctx.clientName,
      submissionToken: ctx.submissionToken,
      attachmentsByItem: undefined,
    });

    await this.recountHouseholdPolicies(householdId);
    await this.recordTimelineEntry(ticket, dto, access.userId);

    return outcome.dealId;
  }

  /**
   * Bring `Household.totalActivePolicies` back in line with reality.
   *
   * Nothing else in the app maintains this field — lead intake writes 0 and only
   * the migration ever wrote anything else — so a household reads "0 active
   * policies" even after buying. A transfer deactivates one policy and activates
   * another, which would make a stale count visibly wrong on the page the CSR is
   * looking at. Recounted rather than incremented so a re-run is still correct.
   */
  private async recountHouseholdPolicies(householdId: string): Promise<void> {
    try {
      const active = await this.policyModel.countDocuments({
        householdId: new Types.ObjectId(householdId),
        active: true,
      });
      await this.householdModel.updateOne(
        { _id: new Types.ObjectId(householdId) },
        { $set: { totalActivePolicies: active } },
      );
    } catch (error) {
      this.logger.error(
        `Failed to recount active policies for household ${householdId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * The ticket's record of what happened.
   *
   * This carries the transfer on the activity trail, because no `Activity` row
   * is written: `ACTIVITY_TYPES` has no member meaning "transferred", and a
   * `sold` row for something that was not sold would be worse than none.
   */
  private async recordTimelineEntry(
    ticket: ServiceTicketDocument,
    dto: CreatePolicyTransferDto,
    userId: string,
  ): Promise<void> {
    try {
      const now = new Date();
      const summary = dto.policies
        .map((row) => `${row.policyNumber} (${row.policyType})`)
        .join(', ');
      await this.ticketModel.updateOne(
        { _id: ticket._id },
        {
          $set: { lastActivityAt: now },
          $push: {
            timeline: {
              type: 'system',
              author: await this.actorName(userId),
              content: `Policy transfer recorded — ${dto.policies.length} ${
                dto.policies.length === 1 ? 'policy' : 'policies'
              }: ${summary}.`,
              at: now,
            },
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to log the transfer on ticket ${String(ticket._id)}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private requireHousehold(ticket: ServiceTicketDocument): string {
    if (!ticket.householdId) {
      throw new BadRequestException(
        'This ticket has no linked household, so there is no book to transfer within.',
      );
    }
    return String(ticket.householdId);
  }

  private async actorName(userId: string): Promise<string> {
    if (!userId || !Types.ObjectId.isValid(userId)) return 'System';
    const user = await this.userModel
      .findById(userId)
      .select('firstName lastName email')
      .lean();
    if (!user) return 'System';
    return (
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
      user.email ||
      'System'
    );
  }
}
