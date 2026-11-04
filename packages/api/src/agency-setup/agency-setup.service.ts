import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AgencySetupView } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import type { CompleteAgencySetupDto } from './dto/agency-setup.dto';

/**
 * The owner's own first-run setup (PAC-69 phase 2).
 *
 * Deliberately tiny: it owns one sub-document on `Agency` and nothing else. The
 * white-label work the wizard walks an owner through is already built — the
 * branding, domain and sender-identity endpoints from the white-label work — and
 * this only records that the walk happened, so the app stops offering it.
 */
@Injectable()
export class AgencySetupService {
  constructor(
    @InjectModel(Agency.name) private agencyModel: Model<AgencyDocument>,
  ) {}

  async get(agencyId: string): Promise<AgencySetupView> {
    const agency = await this.agencyModel
      .findById(agencyId)
      .select('setup')
      .lean();
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }
    return toView(agency.setup);
  }

  /**
   * Mark it done. **Idempotent** — a second call returns the state as it stands
   * rather than conflicting.
   *
   * An owner who finishes the wizard in two browser tabs, or re-submits after a
   * flaky response, has done nothing wrong, and a 409 there would strand them on
   * the last step of a wizard that had in fact already succeeded.
   */
  async complete(
    agencyId: string,
    userId: string,
    dto: CompleteAgencySetupDto,
  ): Promise<AgencySetupView> {
    const agency = await this.agencyModel
      .findById(agencyId)
      .select('setup')
      .lean();
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }
    if (agency.setup?.status === 'complete') {
      return toView(agency.setup);
    }

    const setup = {
      status: 'complete' as const,
      completedAt: new Date(),
      completedByUserId: new Types.ObjectId(userId),
      brandingSkipped: dto.skipped ?? false,
    };
    await this.agencyModel.updateOne({ _id: agencyId }, { $set: { setup } });
    return toView(setup);
  }
}

/**
 * ⚠ Tolerates a missing sub-document. `.lean()` does not apply schema defaults,
 * so every agency created before this feature reads back `undefined` here — and
 * those are exactly the agencies that must count as complete. See `AgencySetup`.
 */
function toView(setup?: {
  status?: string;
  completedAt?: Date | null;
  brandingSkipped?: boolean;
}): AgencySetupView {
  return {
    status: setup?.status === 'pending' ? 'pending' : 'complete',
    completedAt: setup?.completedAt?.toISOString() ?? null,
    brandingSkipped: setup?.brandingSkipped ?? false,
  };
}
