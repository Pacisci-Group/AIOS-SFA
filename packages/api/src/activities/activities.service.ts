import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { LOGGABLE_ACTIVITY_LABELS } from '@sfa/shared';
import type { AccessContext, CreateActivityResponse } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { TenantContextResolver } from '../common/tenancy/tenant-context.resolver';
import { LeadAccessService } from '../leads/lead-access.service';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateActivityDto } from './dto/create-activity.dto';
import { Activity, ActivityDocument } from './schemas/activity.schema';

/**
 * Logging a touch on a lead (PAC-16).
 *
 * One endpoint serves two surfaces: the Producer Dashboard's Call/Text/Email
 * quick actions, and the Lead Detail note composer. They differ only in which
 * `type` they send, so a second endpoint would be two names for one write.
 *
 * **This logs a touch; it does not perform one.** The `tel:`/`sms:`/`mailto:`
 * anchor on the client places the call — the API records that the producer
 * said they made it. Nothing here integrates with a phone system.
 */
@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(
    @InjectModel(Activity.name)
    private readonly activityModel: Model<ActivityDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly leadAccess: LeadAccessService,
    private readonly tenancy: TenantContextResolver,
  ) {}

  async create(
    access: AccessContext,
    branchId: string | null,
    dto: CreateActivityDto,
  ): Promise<CreateActivityResponse> {
    // 404, not 403, for another producer's lead — whether it exists is not the
    // caller's business. This is `LeadAccessService`'s fourth consumer.
    const lead = await this.leadAccess.loadOwnedLead(
      access,
      branchId,
      dto.leadId,
    );
    const tenant = await this.tenancy.resolve(access, branchId);

    const occurredAt = dto.occurredAt ?? new Date();
    const producerId = new Types.ObjectId(access.userId);

    const activity = await this.activityModel.create({
      agencyId: tenant.agencyId,
      branchId: tenant.branchId,
      type: dto.type,
      subjectType: 'lead',
      leadId: lead._id,
      producerId,
      occurredAt,
      summary: dto.summary ?? LOGGABLE_ACTIVITY_LABELS[dto.type],
      // Explicit, because the schema default is `'migration'`. Omitting this
      // would label an app write as migrated data — the same trap documented
      // on `QuoteRecapsService.recordQuotedActivity`.
      source: 'internal',
      isTestRecord: false,
    });

    const leadLastActivityAt = await this.bumpLead(lead._id, occurredAt);

    return {
      activity: {
        id: activity._id.toString(),
        type: activity.type,
        summary: activity.summary ?? null,
        occurredAt: occurredAt.toISOString(),
        producerName: await this.producerName(producerId),
      },
      leadLastActivityAt: leadLastActivityAt.toISOString(),
    };
  }

  /**
   * Move the lead's `lastActivityAt` forward. Best-effort and post-commit: the
   * activity row is the durable artifact and is already written, so failing the
   * request over a denormalized sort key would fail in the wrong direction.
   *
   * `$max`, never `$set`. A **backdated** touch must not drag `lastActivityAt`
   * backwards — that would re-sort the Leads list and float an old lead to the
   * top of the Hot Leads panel. `$max` on a missing field simply sets it.
   */
  private async bumpLead(
    leadId: Types.ObjectId,
    occurredAt: Date,
  ): Promise<Date> {
    try {
      const updated = await this.leadModel
        .findOneAndUpdate(
          { _id: leadId },
          { $max: { lastActivityAt: occurredAt } },
          { new: true, projection: { lastActivityAt: 1 } },
        )
        .lean<{ lastActivityAt?: Date }>();
      return updated?.lastActivityAt ?? occurredAt;
    } catch (error) {
      this.logger.warn(
        `Failed to bump lastActivityAt for lead ${leadId.toString()}`,
        error instanceof Error ? error.stack : undefined,
      );
      return occurredAt;
    }
  }

  /** The caller's display name, for the timeline row we hand straight back. */
  private async producerName(
    producerId: Types.ObjectId,
  ): Promise<string | null> {
    const user = await this.userModel
      .findById(producerId, { firstName: 1, lastName: 1 })
      .lean<{ firstName?: string; lastName?: string }>();
    if (!user) return null;
    const name = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return name || null;
  }
}
