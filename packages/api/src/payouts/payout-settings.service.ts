import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { sortBonusTiers, type PayoutSettingsView } from '@sfa/shared';
import { Model } from 'mongoose';
import {
  payoutSettingsFrom,
  type StoredPayoutSettings,
} from '../common/payouts/payout-settings';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import type { UpdatePayoutSettingsDto } from './dto/payouts.dto';

/**
 * The agency's payout settings (PAC-177): the team bonus and Salesperson of
 * the Month. Stored on `Agency.payouts`; see `AgencyPayoutSettings`.
 */
@Injectable()
export class PayoutSettingsService {
  constructor(
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
  ) {}

  async get(agencyId: string): Promise<PayoutSettingsView> {
    const agency = await this.agencyModel
      .findById(agencyId)
      .select('payouts')
      .lean<{ payouts?: StoredPayoutSettings | null }>();
    if (!agency) throw new NotFoundException('Agency not found');
    return payoutSettingsFrom(agency.payouts);
  }

  /**
   * Writes each section that was sent, whole. A section is `$set` as one
   * object rather than field by field, so a stored settings document never
   * mixes new levels with an old split. Team levels are stored lowest
   * threshold first.
   */
  async update(
    agencyId: string,
    dto: UpdatePayoutSettingsDto,
  ): Promise<PayoutSettingsView> {
    const $set: Record<string, unknown> = {};
    if (dto.teamBonus) {
      $set['payouts.teamBonus'] = {
        ...dto.teamBonus,
        levels: sortBonusTiers(dto.teamBonus.levels),
      };
    }
    if (dto.salespersonOfMonth) {
      $set['payouts.salespersonOfMonth'] = dto.salespersonOfMonth;
    }
    const agency = await this.agencyModel
      .findByIdAndUpdate(agencyId, { $set }, { new: true, runValidators: true })
      .select('payouts')
      .lean<{ payouts?: StoredPayoutSettings | null }>();
    if (!agency) throw new NotFoundException('Agency not found');
    return payoutSettingsFrom(agency.payouts);
  }
}
