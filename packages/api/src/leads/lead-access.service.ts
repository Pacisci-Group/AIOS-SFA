import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DataScope } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  Household,
  HouseholdDocument,
} from '../households/schemas/household.schema';
import { Lead, LeadDocument } from './schemas/lead.schema';

/**
 * Scope-clamped lead lookup and household resolution, shared by every
 * lead-scoped write path.
 *
 * Extracted from `QuoteRecapsService` (PAC-39) when the Sold form (PAC-40)
 * needed the identical two operations. Both carry semantics that are easy to
 * get subtly wrong on a re-implementation — a 403 instead of a 404, or a
 * missing legacy fallback — so there is deliberately one copy.
 */
@Injectable()
export class LeadAccessService {
  private readonly logger = new Logger(LeadAccessService.name);

  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Household.name)
    private readonly householdModel: Model<HouseholdDocument>,
  ) {}

  /**
   * Load a lead inside the caller's agency and enforce data scope.
   *
   * 404 throughout — the same shape as `ShareLinksService.loadOwnedLink`, and
   * for the same reason: whether another producer's lead exists is not the
   * caller's business. Note `Lead.producerId` is optional, so an **unassigned**
   * lead is also a 404 under `own` scope, which is correct.
   */
  async loadOwnedLead(
    access: AccessContext,
    branchId: string | null,
    leadId: string,
  ): Promise<LeadDocument> {
    // A malformed id is a miss, not a 500.
    if (!Types.ObjectId.isValid(leadId)) {
      throw new NotFoundException('Lead not found.');
    }

    const lead = await this.leadModel.findOne({
      _id: new Types.ObjectId(leadId),
      agencyId: access.agencyId,
    });
    if (!lead) throw new NotFoundException('Lead not found.');

    this.assertLeadInScope(lead, access, branchId);
    return lead;
  }

  /**
   * The same clamp applied to an already-loaded lead-scoped document — the
   * replay path, where the record was found by submission token rather than by
   * id and must not be handed back to another producer.
   */
  assertOwned(
    record: { producerId?: Types.ObjectId; branchId?: string },
    access: AccessContext,
    branchId: string | null,
  ): void {
    if (
      access.dataScope === DataScope.Own &&
      record.producerId?.toString() !== access.userId
    ) {
      throw new NotFoundException('Lead not found.');
    }
    if (
      access.dataScope === DataScope.Branch &&
      branchId &&
      record.branchId !== branchId
    ) {
      throw new NotFoundException('Lead not found.');
    }
  }

  private assertLeadInScope(
    lead: LeadDocument,
    access: AccessContext,
    branchId: string | null,
  ): void {
    this.assertOwned(
      { producerId: lead.producerId, branchId: lead.branchId },
      access,
      branchId,
    );
  }

  /**
   * The lead's household, self-healing the missing link, or `null`.
   *
   * The migration writes only `legacyHouseholdId` on leads — never
   * `householdId` — so without the legacy fallback every migrated lead would be
   * unable to record a recap or a sale. Mirrors `ResolveHouseholdStep
   * .findExisting`: each record repairs itself the first time it is touched.
   *
   * Returns `null` rather than throwing so a context endpoint can report the
   * gap up front instead of letting a producer fill a whole form and fail at
   * submit; {@link resolveHousehold} is the strict variant.
   */
  async findHousehold(
    lead: LeadDocument,
    access: AccessContext,
  ): Promise<HouseholdDocument | null> {
    if (lead.householdId) {
      const byId = await this.householdModel.findOne({
        _id: lead.householdId,
        agencyId: access.agencyId,
      });
      if (byId) return byId;
    }

    if (lead.legacyHouseholdId) {
      const byLegacy = await this.householdModel.findOne({
        agencyId: access.agencyId,
        legacySmartSuiteId: lead.legacyHouseholdId,
      });
      if (byLegacy) {
        // Fire-and-forget backfill: the next read takes the fast path.
        await this.leadModel
          .updateOne({ _id: lead._id }, { $set: { householdId: byLegacy._id } })
          .catch((error: unknown) => {
            this.logger.warn(
              `Failed to backfill householdId on lead ${lead._id.toString()}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
        return byLegacy;
      }
    }

    return null;
  }

  /** {@link findHousehold}, but a missing household is a 409. */
  async resolveHousehold(
    lead: LeadDocument,
    access: AccessContext,
  ): Promise<HouseholdDocument> {
    const household = await this.findHousehold(lead, access);
    if (household) return household;

    // Deliberately not auto-creating one: that would bypass the contact-first
    // derivation in lead intake, which exists to stop a client acquiring
    // duplicate households.
    throw new ConflictException('This lead is not linked to a household yet.');
  }
}
