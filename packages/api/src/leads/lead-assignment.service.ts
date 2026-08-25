import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { normalizeLeadStatus } from '@sfa/shared';
import type { AccessContext, ReassignLeadResult } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  Activity,
  ActivityDocument,
} from '../activities/schemas/activity.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { LeadAccessService } from './lead-access.service';
import { Lead, LeadDocument } from './schemas/lead.schema';

/**
 * Hand a lead to a different user (PAC-72 section D).
 *
 * ## Why this is its own service
 *
 * Three callers want exactly this operation and only one exists today:
 * the Lead Detail control (this ticket), PAC-53's round-robin **at intake**,
 * and the unticketed bulk reassignment recorded in PAC-65's *Not in this
 * ticket* section. Writing it once is the point — the freeze rule and the
 * activity contract are both easy to get subtly wrong on a re-implementation.
 *
 * ## There is no cascade
 *
 * This looked much larger than it is. A lead can only be reassigned **before
 * it is sold**, and `deals`, `dealAuditItems` and `priorInsurance` are all
 * post-sale records — so none of them is ever reachable from here.
 *
 * `quoteRecaps` are reachable and deliberately **do not move**: the original
 * quoter keeps the credit, and the new owner writes a fresh recap. That is what
 * keeps the Quoted scorecard historically accurate.
 *
 * So the whole operation is one field and one activity row.
 */
@Injectable()
export class LeadAssignmentService {
  private readonly logger = new Logger(LeadAssignmentService.name);

  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Activity.name)
    private readonly activityModel: Model<ActivityDocument>,
    private readonly leadAccess: LeadAccessService,
  ) {}

  /**
   * Move `leadId` to `producerId`.
   *
   * The caller's permissions are checked by the guard chain
   * (`leads:write` + `agency:users:read`); this enforces the data rules.
   */
  async assign(
    access: AccessContext,
    branchId: string | null,
    leadId: string,
    producerId: string,
  ): Promise<ReassignLeadResult> {
    // 404, never 403, for a lead outside the caller's scope — whether another
    // producer's lead exists is not their business.
    const lead = await this.leadAccess.loadOwnedLead(access, branchId, leadId);

    this.assertNotSold(lead);
    const next = await this.resolveTarget(access, producerId);

    const previousId = lead.producerId ?? null;
    if (previousId?.toString() === next._id.toString()) {
      // Idempotent: re-selecting the current owner is a no-op rather than a
      // spurious timeline entry saying nothing changed.
      return this.result(lead, next);
    }

    const previousName = await this.displayName(previousId);

    lead.producerId = next._id;
    lead.lastActivityAt = new Date();
    await lead.save();

    await this.recordActivity(
      access,
      lead,
      previousName,
      this.nameOf(next) || next.email,
    );

    return this.result(lead, next);
  }

  /**
   * The freeze: a sold lead's owner is fixed.
   *
   * Once a lead is sold the sale is the record of who earned it, and
   * `Deal.producerId` is what the scorecards and the leaderboard read. Letting
   * the lead move afterwards would make those two disagree about the same sale.
   *
   * ⚠ **Known gap, deliberately unfixed** (decided 2026-08-21). `PATCH
   * /leads/:id` accepts `status`, so a user holding `leads:write` can flip a
   * lead out of `Sold`, reassign it, and flip it back — keying the freeze on
   * status alone is not airtight. The robust fix, when it is wanted, is to
   * check for a linked `Deal` as well: a deal existing is a fact, a status is
   * an opinion. Recorded so this is a known gap rather than a surprise.
   */
  private assertNotSold(lead: LeadDocument): void {
    if (normalizeLeadStatus(lead.status) === 'Sold') {
      throw new ConflictException(
        'A sold lead cannot be reassigned — the sale records who earned it.',
      );
    }
  }

  /** The incoming owner: must exist, be active, and be in the same agency. */
  private async resolveTarget(
    access: AccessContext,
    producerId: string,
  ): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(producerId)) {
      throw new NotFoundException('That user was not found.');
    }

    const user = await this.userModel.findOne({
      _id: new Types.ObjectId(producerId),
      // Tenancy clamp. `User.agencyId` is an ObjectId, unlike `TenantRecord`'s
      // string — comparing the wrong one silently matches nothing.
      agencyId: new Types.ObjectId(access.agencyId ?? ''),
    });
    if (!user) {
      throw new NotFoundException('That user was not found.');
    }
    if (!user.isActive) {
      // Assigning to a de-provisioned account is how a lead quietly reaches
      // nobody — it would sit on no one's board and chase itself.
      throw new ConflictException(
        'That user is deactivated and cannot take on leads.',
      );
    }
    return user;
  }

  /**
   * Append the reassignment to the lead's timeline.
   *
   * Best-effort and post-commit: the lead has already moved, and failing the
   * request over a timeline entry would fail in the wrong direction.
   */
  private async recordActivity(
    access: AccessContext,
    lead: LeadDocument,
    fromName: string | null,
    toName: string,
  ): Promise<void> {
    try {
      await this.activityModel.create({
        agencyId: lead.agencyId,
        branchId: lead.branchId,
        type: 'lead_reassigned',
        subjectType: 'lead',
        leadId: lead._id,
        /*
         * 🔴 The **actor**, not the new owner. See `lead_reassigned` in
         * `@sfa/shared`'s activity vocabulary — this field is the record of who
         * did the thing, and rewriting it would forge history.
         */
        userId: new Types.ObjectId(access.userId),
        occurredAt: lead.lastActivityAt,
        /*
         * The names go here, not in `changes`. A `field_changed` row is hidden
         * from anyone without `ChangeLogsRead` — which is every producer — and
         * the producer losing the lead is precisely who needs to see this.
         */
        summary: fromName
          ? `Lead reassigned from ${fromName} to ${toName}`
          : `Lead assigned to ${toName}`,
        // Explicit: the schema default is `'migration'`, which would label an
        // app write as imported data.
        source: 'internal',
        isTestRecord: false,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record lead_reassigned activity for lead ${lead._id.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private result(lead: LeadDocument, owner: UserDocument): ReassignLeadResult {
    return {
      id: lead._id.toString(),
      producerId: owner._id.toString(),
      producerName: this.nameOf(owner) || owner.email,
      lastActivityAt: (lead.lastActivityAt ?? new Date()).toISOString(),
    };
  }

  private nameOf(user: { firstName?: string; lastName?: string }): string {
    return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  }

  /** The outgoing owner's name, or `null` for a lead nobody owned. */
  private async displayName(
    userId: Types.ObjectId | null,
  ): Promise<string | null> {
    if (!userId) return null;
    const user = await this.userModel
      .findById(userId)
      .select('firstName lastName email')
      .lean<{ firstName?: string; lastName?: string; email?: string }>();
    if (!user) return null;
    return this.nameOf(user) || user.email || null;
  }
}
