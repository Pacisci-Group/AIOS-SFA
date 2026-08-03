import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  SOLD_ADVANCE_TARGET,
  normalizeLeadStatus,
  soldAdvanceableStatusValues,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { Lead, LeadDocument } from '../../leads/schemas/lead.schema';

/**
 * Move the lead to "Sold", forward only.
 *
 * One atomic conditional update, so the forward-only rule is a database
 * invariant rather than a read-then-write race — the same technique
 * `QuoteRecapsService.advanceLeadStatus` uses for "Quoted".
 *
 * `lastActivityAt` moves too: the Leads list sorts on it, and a lead you just
 * sold should not sink below untouched ones.
 *
 * Best-effort. By the time this runs the deal is committed, and it is
 * idempotent, so the replay path re-runs it to self-heal a create whose
 * follow-up died.
 */
@Injectable()
export class AdvanceLeadStep {
  private readonly logger = new Logger(AdvanceLeadStep.name);

  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
  ) {}

  async run(leadId: Types.ObjectId, agencyId: string): Promise<string> {
    try {
      const advanced = await this.leadModel.findOneAndUpdate(
        {
          _id: leadId,
          agencyId,
          // The allowlist expands to raw SmartSuite codes too, so a migrated
          // Qualified (`hfwda`) or Requote (`arW7O`) lead advances. An
          // uncatalogued value matches nothing and stays put.
          status: { $in: soldAdvanceableStatusValues() },
        },
        { $set: { status: SOLD_ADVANCE_TARGET, lastActivityAt: new Date() } },
        { new: true, projection: { status: 1 } },
      );
      if (advanced) return normalizeLeadStatus(advanced.status);

      // No match means the lead is already Sold or terminal. One extra read to
      // report what it actually is — only on that branch.
      const current = await this.leadModel.findById(leadId).select('status');
      return normalizeLeadStatus(current?.status);
    } catch (error) {
      this.logger.error(
        `Failed to advance status for lead ${leadId.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
      return SOLD_ADVANCE_TARGET;
    }
  }
}
