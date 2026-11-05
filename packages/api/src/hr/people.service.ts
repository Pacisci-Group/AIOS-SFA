import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type {
  AccessContext,
  BalanceAdjustmentResult,
  PersonProfileView,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { businessDateInstant } from '../common/dates/business-dates';
import {
  assertDateOfBirth,
  assertHireDate,
} from '../common/hr/employee-profile.rules';
import { EmployeeProfilesService } from '../common/hr/employee-profiles.service';
import { balanceAsOf } from '../common/time-off/balance-as-of';
import { LeaveLedgerService } from '../common/time-off/leave-ledger.service';
import { notificationRequested } from '../inngest/events';
import { InngestService } from '../inngest/inngest.service';
import { agencyTodayIso } from '../performance/performance.range';
import { User, type UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import type {
  BalanceAdjustmentDto,
  CompleteOnboardingDto,
  UpdatePersonFactsDto,
} from './dto/people.dto';
import { HrPoliciesService } from './hr-policies.service';
import {
  TimeOffPolicy,
  type TimeOffPolicyDocument,
} from './schemas/time-off-policy.schema';

/**
 * The HR writes on a person (PAC-162): edit the facts, complete onboarding.
 * Every caller holds `agency:hr:admin`. Reads go through
 * `UsersService.personProfile`, which is what both return so the page
 * re-renders from one shape.
 *
 * ## Name and phone are user facts, hire date and birthday profile facts
 *
 * One write touches two documents, each the home of its fact: `users` for
 * the name halves and the phone (the person edits the same fields at
 * `/settings/profile`), `employeeProfiles` for the dates. The profile
 * service bounds the dates on the agency's calendar day.
 *
 * ## Complete onboarding enrols first, then flips the status
 *
 * Enrolment never required an active profile, and `HrPoliciesService.enrol`
 * is idempotent, so a failed policy (a stale id, a refused balance) leaves
 * the person still pending with the earlier enrolments done and the request
 * simply retryable. The other order would leave an Active person half
 * enrolled with nothing to retry. Not a transaction, for the same reason
 * `deactivateUser` gives.
 */
@Injectable()
export class PeopleService {
  private readonly logger = new Logger(PeopleService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(TimeOffPolicy.name)
    private readonly timeOffPolicies: Model<TimeOffPolicyDocument>,
    private readonly profiles: EmployeeProfilesService,
    private readonly policies: HrPoliciesService,
    private readonly directory: UsersService,
    private readonly ledger: LeaveLedgerService,
    private readonly inngest: InngestService,
  ) {}

  /**
   * An HR admin's correction to a balance (PAC-165): a signed
   * `manual_adjustment` row, effective today on the agency's calendar, with
   * the reason kept on the row. The ledger is append-only — a wrong
   * adjustment is corrected by another one, never edited.
   *
   * It is also the tool for the things the request flow refuses on purpose:
   * leave in a period that has already reset, a day the accrual job never
   * ran. Not offered on an Unlimited policy, which has no balance to move.
   */
  async adjustBalance(
    access: AccessContext,
    agencyId: string,
    userId: string,
    dto: BalanceAdjustmentDto,
  ): Promise<BalanceAdjustmentResult> {
    const user = await this.requireUser(agencyId, userId);
    const policy = await this.timeOffPolicies
      .findOne({
        _id: new Types.ObjectId(dto.policyId),
        agencyId,
        archivedAt: null,
      })
      .select('name accrualType memberIds')
      .lean<{
        _id: Types.ObjectId;
        name: string;
        accrualType?: string;
        memberIds?: Types.ObjectId[];
      } | null>();
    if (!policy) {
      throw new NotFoundException('That time off policy does not exist.');
    }
    if (policy.accrualType === 'unlimited') {
      throw new BadRequestException(
        'An unlimited policy has no balance to adjust.',
      );
    }
    if (!(policy.memberIds ?? []).some((id) => id.equals(user._id))) {
      throw new BadRequestException('That person is not in this policy.');
    }

    const rowId = await this.ledger.postAdjustment({
      agencyId,
      policyId: policy._id,
      userId: user._id,
      hours: dto.hours,
      note: dto.reason,
      effectiveAt: businessDateInstant(
        agencyTodayIso(access.timeZone),
        access.timeZone,
      ),
    });
    const balances = await this.ledger.balances(
      agencyId,
      policy._id,
      [user._id],
      balanceAsOf(access.timeZone),
    );

    // After the write, and never allowed to fail it. Nobody is told about
    // an adjustment they made to their own balance.
    if (userId !== access.userId) {
      try {
        const actor = await this.users
          .findById(access.userId)
          .select('firstName lastName email')
          .lean<{
            firstName?: string;
            lastName?: string;
            email: string;
          } | null>();
        await this.inngest.send(notificationRequested, {
          type: 'time_off.balance_adjusted',
          recipientIds: [userId],
          agencyId,
          actorId: access.userId,
          entity: { kind: 'leaveLedger', id: rowId.toString() },
          data: {
            policyName: policy.name,
            hours: dto.hours,
            reason: dto.reason,
            actorName: actor
              ? [actor.firstName, actor.lastName].filter(Boolean).join(' ') ||
                actor.email
              : null,
          },
          dedupeKey: `time_off.balance_adjusted:${rowId.toString()}`,
        });
      } catch (err) {
        this.logger.warn(
          `Could not request the balance-adjusted notification for ${userId}: ${String(err)}`,
        );
      }
    }
    return { balanceHours: balances.get(userId)?.current ?? 0 };
  }

  async updateFacts(
    access: AccessContext,
    agencyId: string,
    userId: string,
    dto: UpdatePersonFactsDto,
  ): Promise<PersonProfileView> {
    await this.writeUserFacts(agencyId, userId, dto);
    const facts = pick(dto, ['hireDate', 'dateOfBirth', 'showBirthday']);
    if (Object.keys(facts).length) {
      await this.profiles.updateFacts(
        agencyId,
        userId,
        facts,
        agencyTodayIso(access.timeZone),
      );
    }
    return this.directory.personProfile(access, agencyId, userId);
  }

  async completeOnboarding(
    access: AccessContext,
    agencyId: string,
    userId: string,
    dto: CompleteOnboardingDto,
  ): Promise<PersonProfileView> {
    const today = agencyTodayIso(access.timeZone);
    // Bound the dates before any write, so a bad date enrols nobody.
    assertHireDate(dto.hireDate, today);
    if (dto.dateOfBirth) assertDateOfBirth(dto.dateOfBirth, today);
    await this.requireUser(agencyId, userId);

    for (const choice of dto.policies) {
      await this.policies.enrol(
        agencyId,
        choice.policyId,
        userId,
        choice.startingBalanceHours,
        access.timeZone,
      );
    }
    await this.writeUserFacts(agencyId, userId, { phone: dto.phone });
    await this.profiles.completeOnboarding(
      agencyId,
      userId,
      pick(dto, ['hireDate', 'dateOfBirth', 'showBirthday']),
      access.userId,
      today,
    );
    return this.directory.personProfile(access, agencyId, userId);
  }

  /** The name halves and the phone; `null` clears, absent leaves alone. */
  private async writeUserFacts(
    agencyId: string,
    userId: string,
    dto: Pick<UpdatePersonFactsDto, 'firstName' | 'lastName' | 'phone'>,
  ): Promise<void> {
    const user = await this.requireUser(agencyId, userId);
    const $set: Record<string, string> = {};
    const $unset: Record<string, ''> = {};
    for (const field of ['firstName', 'lastName', 'phone'] as const) {
      const value = dto[field];
      if (value === undefined) continue;
      if (value === null) $unset[field] = '';
      else $set[field] = value;
    }
    if (!Object.keys($set).length && !Object.keys($unset).length) return;
    await this.users.updateOne(
      { _id: user._id },
      {
        ...(Object.keys($set).length ? { $set } : {}),
        ...(Object.keys($unset).length ? { $unset } : {}),
      },
    );
  }

  private async requireUser(
    agencyId: string,
    userId: string,
  ): Promise<{ _id: Types.ObjectId }> {
    const user = await this.users
      .findOne({
        _id: new Types.ObjectId(userId),
        agencyId: new Types.ObjectId(agencyId),
        isPlatformAdmin: { $ne: true },
      })
      .select('_id')
      .lean<{ _id: Types.ObjectId } | null>();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}

/** The keys of `source` that are present, as a new object. */
function pick<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}
