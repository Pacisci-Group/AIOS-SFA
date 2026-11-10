import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DataScope,
  normalizePolicyType,
  payoutCarrierName,
  toDealView,
  type AccessContext,
  type PayoutActivityPeopleResponse,
  type PayoutActivityView,
} from '@sfa/shared';
import { Types } from 'mongoose';
import { DEFAULT_AGENCY_TIME_ZONE } from '../common/dates/time-zones';
import { leadSourceLabels } from '../common/payouts/lead-source-labels';
import { loadRunInputs } from '../common/payouts/load-run-inputs';
import {
  currentMonthIn,
  isMonthAfter,
  monthWindow,
} from '../common/payouts/month-window';
import { loadPayoutPeople } from '../common/payouts/payout-people';
import type { PayoutActivityQueryDto } from './dto/payouts.dto';
import { PayoutModelsService } from './payout-models.service';
import {
  activityAccess,
  agencyOf,
  readsOthersPay,
  statementVisibility,
} from './statement-visibility';

/**
 * Everything one producer or CSR sold and had charged back in a month
 * (PAC-179) — the same loader the statements are computed from, so for a
 * month with a statement the totals are the statement's, but for any month
 * and anyone the caller may see, statement or not.
 */
@Injectable()
export class PayoutActivityService {
  constructor(private readonly payoutModels: PayoutModelsService) {}

  private get models() {
    return this.payoutModels.models;
  }

  /**
   * 403 for someone else's activity without `payouts:write`; 404 for a
   * person outside the agency or the caller's scope.
   */
  async activity(
    access: AccessContext,
    branchId: string | null,
    query: PayoutActivityQueryDto,
  ): Promise<PayoutActivityView> {
    const agencyId = agencyOf(access);
    const userId = query.userId ?? access.userId;
    if (userId !== access.userId && !readsOthersPay(access)) {
      throw new ForbiddenException(
        'You can only see your own sales and chargebacks.',
      );
    }
    const user = await this.models.user
      .findOne({
        _id: new Types.ObjectId(userId),
        agencyId: new Types.ObjectId(agencyId),
        isPlatformAdmin: { $ne: true },
      })
      .select({ firstName: 1, lastName: 1, email: 1, branchId: 1 })
      .lean<{
        _id: Types.ObjectId;
        firstName?: string;
        lastName?: string;
        email: string;
        branchId?: Types.ObjectId | null;
      } | null>();
    if (!user) throw new NotFoundException('Person not found');
    const verdict = activityAccess(access, branchId, user);
    if (verdict === 'forbidden') {
      throw new ForbiddenException(
        'You can only see your own sales and chargebacks.',
      );
    }
    if (verdict === 'out_of_scope')
      throw new NotFoundException('Person not found');

    const agency = await this.models.agency
      .findById(agencyId)
      .select({ timezone: 1 })
      .lean<{ timezone?: string } | null>();
    const timeZone = agency?.timezone ?? DEFAULT_AGENCY_TIME_ZONE;
    if (isMonthAfter(query.month, currentMonthIn(timeZone))) {
      throw new BadRequestException('That month has not started yet.');
    }

    const [inputs, labels, statement] = await Promise.all([
      loadRunInputs(this.models, {
        agencyId,
        month: query.month,
        window: monthWindow(query.month, timeZone),
        timeZone,
        memberIds: [userId],
      }),
      leadSourceLabels(this.models.leadSource, agencyId),
      this.models.payStatement
        .findOne({
          ...statementVisibility(access, branchId),
          userId: user._id,
          month: query.month,
        })
        .select({ _id: 1 })
        .lean<{ _id: Types.ObjectId } | null>(),
    ]);

    const deals = (inputs.sales.get(userId) ?? []).map((sale) =>
      toDealView(sale, labels),
    );
    const chargebacks = (inputs.chargebacks.get(userId) ?? []).map((row) => ({
      chargebackId: row.chargebackId,
      policyId: row.policyId,
      householdId: row.householdId ?? null,
      policyNumber: row.policyNumber,
      policyType: row.policyType ? normalizePolicyType(row.policyType) : null,
      carrier: payoutCarrierName(row.carrier),
      customerName: row.customerName,
      amount: row.amount,
      occurredAt: row.occurredAt,
      occurredDay: row.occurredDay,
      reason: row.reason,
      source: row.source,
    }));
    const cents = (values: number[]) =>
      values.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100;

    return {
      userId,
      userName:
        [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
        user.email,
      month: query.month,
      statementId: statement ? String(statement._id) : null,
      deals,
      chargebacks,
      totals: {
        deals: deals.length,
        policies: deals.reduce((sum, deal) => sum + deal.policyCount, 0),
        premium: cents(deals.map((deal) => deal.premium)),
        bundles: deals.filter((deal) => deal.isBundle).length,
        chargebacks: chargebacks.length,
        chargebackTotal: cents(chargebacks.map((row) => row.amount)),
      },
    };
  }

  /**
   * Whose activity a reviewer may open: everyone in the agency (owner) or in
   * their branch (branch manager), people not removed from the agency.
   */
  async people(
    access: AccessContext,
    branchId: string | null,
  ): Promise<PayoutActivityPeopleResponse> {
    const agencyId = agencyOf(access);
    const people = await loadPayoutPeople(
      {
        userModel: this.models.user,
        roleModel: this.models.role,
        userRoleModel: this.models.userRole,
        branchModel: this.models.branch,
      },
      agencyId,
    );
    const inScope = [...people.values()].filter((person) => {
      if (access.dataScope === DataScope.Agency) return true;
      if (access.dataScope === DataScope.Branch) {
        return Boolean(branchId) && person.branchId === branchId;
      }
      return person.id === access.userId;
    });
    return {
      people: inScope.map((person) => ({
        id: person.id,
        name: person.name,
        roles: person.roles,
        status: person.status,
        branchName: person.branchName,
      })),
    };
  }
}
