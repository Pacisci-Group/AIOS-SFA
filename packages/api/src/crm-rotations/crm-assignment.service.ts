import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import {
  Household,
  HouseholdDocument,
} from '../households/schemas/household.schema';
import {
  ProducerAssignment,
  ProducerAssignmentDocument,
} from '../producer-assignments/schemas/producer-assignment.schema';
import {
  CrmRotation,
  CrmRotationDocument,
} from './schemas/crm-rotation.schema';

export type CrmAssignmentStatus =
  'assigned' | 'skipped_existing' | 'no_pool' | 'missing_input' | 'failed';

export interface AssignCrmInput {
  agencyId: string;
  branchId: string;
  dealId: Types.ObjectId;
  householdId?: Types.ObjectId;
  producerId?: Types.ObjectId;
}

export interface AssignCrmResult {
  status: CrmAssignmentStatus;
  crmId?: Types.ObjectId;
}

/**
 * Round-robin CRM assignment (PAC-40) — a port of legacy's `maybeAssignCrm`,
 * taking the richer `SFA/lib/smartsuite/crmAssignment.ts` as the model rather
 * than the webhook's simplified inline copy.
 *
 * Without it, sold deals reach the service team unassigned.
 *
 * ## The household is the idempotency anchor
 *
 * Not the deal. A household that already has a CRM keeps them for every
 * subsequent sale — the relationship is with the client, not the transaction,
 * and reshuffling it on a second policy would hand a familiar client to a
 * stranger.
 */
@Injectable()
export class CrmAssignmentService {
  private readonly logger = new Logger(CrmAssignmentService.name);

  constructor(
    @InjectModel(CrmRotation.name)
    private readonly rotationModel: Model<CrmRotationDocument>,
    @InjectModel(ProducerAssignment.name)
    private readonly assignmentModel: Model<ProducerAssignmentDocument>,
    @InjectModel(Household.name)
    private readonly householdModel: Model<HouseholdDocument>,
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
  ) {}

  async assignForDeal(input: AssignCrmInput): Promise<AssignCrmResult> {
    try {
      return await this.assign(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `CRM assignment failed for deal ${input.dealId.toString()}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.stampDeal(input.dealId, {
        crmAssignmentStatus: 'failed',
        crmAssignmentError: message,
      });
      return { status: 'failed' };
    }
  }

  private async assign(input: AssignCrmInput): Promise<AssignCrmResult> {
    const { agencyId, dealId, householdId, producerId } = input;

    if (!householdId || !producerId) {
      await this.stampDeal(dealId, {
        crmAssignmentStatus: 'missing_input',
      });
      return { status: 'missing_input' };
    }

    // 1. Already assigned? Mirror onto the deal and stop.
    const household = await this.householdModel
      .findOne({ _id: householdId, agencyId })
      .select('assignedCrmId');

    if (household?.assignedCrmId) {
      await this.mirrorToDeal(dealId, household.assignedCrmId);
      return { status: 'skipped_existing', crmId: household.assignedCrmId };
    }

    // 2. The producer's active rotation, ordered.
    //
    // `_id` is the tie-break legacy sorts on, and it matters: two rotation rows
    // sharing an `order` would otherwise come back in whatever order the index
    // happened to yield, so the same pointer could select different people on
    // different runs.
    const pool = (
      await this.rotationModel
        .find({ agencyId, producerId, activeForProducer: true })
        .sort({ order: 1, _id: 1 })
        .select('crmId')
        .lean<Array<{ _id: Types.ObjectId; crmId?: Types.ObjectId }>>()
    )
      .map((row) => row.crmId)
      .filter((id): id is Types.ObjectId => Boolean(id));

    if (!pool.length) {
      await this.stampDeal(dealId, { crmAssignmentStatus: 'no_pool' });
      return { status: 'no_pool' };
    }

    // 3. Pointer state, created on first use.
    const assignment = await this.assignmentModel.findOneAndUpdate(
      { agencyId, producerId },
      {
        $setOnInsert: {
          agencyId,
          branchId: input.branchId,
          producerId,
          indexPointer: 0,
          activeForProducer: true,
        },
      },
      { upsert: true, new: true },
    );

    const pointer = assignment?.indexPointer ?? 0;
    // Double modulo guards a negative pointer, and the `|| 0` a NaN one —
    // legacy guarded only NaN, and a negative index silently selects nobody.
    const index = ((pointer % pool.length) + pool.length) % pool.length || 0;
    const chosen = pool[index];

    // 4. Claim the household **conditionally**, so "never reassign" is a
    //    database invariant rather than a read-then-write race. Same technique
    //    as `LeadIntakeService.assignProducer`.
    const claim = await this.householdModel.updateOne(
      { _id: householdId, agencyId, assignedCrmId: { $in: [null, undefined] } },
      { $set: { assignedCrmId: chosen } },
    );

    if (claim.modifiedCount === 0) {
      // Someone else won between the read and the write. Take their answer
      // rather than overwriting it, and leave the pointer alone — they moved it.
      const current = await this.householdModel
        .findOne({ _id: householdId, agencyId })
        .select('assignedCrmId');
      if (current?.assignedCrmId) {
        await this.mirrorToDeal(dealId, current.assignedCrmId);
        return { status: 'skipped_existing', crmId: current.assignedCrmId };
      }
      return { status: 'failed' };
    }

    // 5. Advance the pointer, unless the rotation is locked.
    //
    // Compare-and-swap on the pointer we read: without the guard two concurrent
    // sales for one producer both advance past the same slot, so a CRM is
    // skipped entirely in the rotation.
    if (assignment?.lock !== true) {
      await this.assignmentModel.updateOne(
        { _id: assignment?._id, indexPointer: pointer },
        {
          $set: {
            indexPointer: (index + 1) % pool.length,
            lastAssignedCrmId: chosen,
            lastAssignedAt: new Date(),
          },
        },
      );
    }

    await this.mirrorToDeal(dealId, chosen);
    return { status: 'assigned', crmId: chosen };
  }

  /**
   * Copy the household's CRM onto the deal — but only when the deal has none
   * or already agrees.
   *
   * Legacy is explicit about never overwriting a differing value: someone
   * reassigned it by hand, and that decision outranks the rotation.
   */
  private async mirrorToDeal(
    dealId: Types.ObjectId,
    crmId: Types.ObjectId,
  ): Promise<void> {
    const deal = await this.dealModel.findById(dealId).select('assignedCrmId');

    const existing = deal?.assignedCrmId;
    if (existing && existing.toString() !== crmId.toString()) {
      this.logger.warn(
        `Deal ${dealId.toString()} already has CRM ${existing.toString()}; ` +
          `leaving it rather than replacing with ${crmId.toString()}.`,
      );
      return;
    }

    await this.stampDeal(dealId, {
      assignedCrmId: crmId,
      crmAssignedAt: new Date(),
      crmAssignmentStatus: 'assigned',
    });
  }

  private async stampDeal(
    dealId: Types.ObjectId,
    update: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.dealModel.updateOne({ _id: dealId }, { $set: update });
    } catch (error) {
      this.logger.error(
        `Failed to stamp CRM telemetry on deal ${dealId.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
