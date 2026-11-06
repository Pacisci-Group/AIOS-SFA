import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgencyPermission,
  DataScope,
  EDITABLE_PAY_STATEMENT_STATUSES,
  isEditableStatementStatus,
  PAYOUT_STATEMENT_NOT_EDITABLE,
  PAYOUT_STATEMENT_OWN_INPUTS,
  type AccessContext,
  type PayStatementsResponse,
  type PayStatementView,
} from '@sfa/shared';
import { Types, type FilterQuery } from 'mongoose';
import { escapeRegex } from '../common/mongo/escape-regex';
import { recomputeStatement } from '../common/payouts/generate-run';
import type {
  ListPayStatementsQueryDto,
  UpdateStatementInputsDto,
} from './dto/payouts.dto';
import { PayoutModelsService } from './payout-models.service';
import {
  statementSummary,
  statementView,
  type LeanStatement,
} from './payout-views';
import type { PayStatement } from './schemas/pay-statement.schema';
import {
  agencyOf,
  readsOthersPay,
  statementVisibility,
} from './statement-visibility';

/**
 * Pay statements (PAC-178): the Payouts table, My Pay, one statement, and
 * recalculating one. Every read starts from `statementVisibility` — the
 * employee sees their own sent statements, a reviewer what their scope
 * reaches — and a statement the caller may not see is a 404, never a 403,
 * so its existence is not given away.
 */
@Injectable()
export class PayStatementsService {
  constructor(private readonly payoutModels: PayoutModelsService) {}

  private get models() {
    return this.payoutModels.models;
  }

  async list(
    access: AccessContext,
    branchId: string | null,
    query: ListPayStatementsQueryDto,
  ): Promise<PayStatementsResponse> {
    const filter: FilterQuery<PayStatement> = {
      ...statementVisibility(access, branchId, {
        mine: query.mine === 'true',
      }),
    };
    if (query.month) filter.month = query.month;
    if (query.status) {
      // Never lets the employee rule's "no drafts" be asked back in.
      filter.status =
        filter.status !== undefined
          ? { $eq: query.status, ...(filter.status as object) }
          : query.status;
    }
    // A branch filter only narrows an agency-wide view; a branch manager is
    // already pinned to their own (and the branch guard refuses another).
    if (
      query.branchId &&
      readsOthersPay(access) &&
      access.dataScope === DataScope.Agency &&
      query.mine !== 'true'
    ) {
      filter.branchId = query.branchId;
    }
    if (query.q) {
      filter.userName = { $regex: escapeRegex(query.q), $options: 'i' };
    }

    const [total, rows] = await Promise.all([
      this.models.payStatement.countDocuments(filter),
      this.models.payStatement
        .find(filter)
        // The heavy arrays are the detail page's; a row needs the totals.
        .select({ premiumLines: 0, deals: 0, chargebacks: 0 })
        .sort({ month: -1, userName: 1, _id: 1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<LeanStatement[]>(),
    ]);
    return {
      statements: rows.map(statementSummary),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  private async findVisible(
    access: AccessContext,
    branchId: string | null,
    id: string,
  ): Promise<LeanStatement> {
    const doc = await this.models.payStatement
      .findOne({
        ...statementVisibility(access, branchId),
        _id: new Types.ObjectId(id),
      })
      .lean<LeanStatement | null>();
    if (!doc) throw new NotFoundException('Statement not found');
    return doc;
  }

  async detail(
    access: AccessContext,
    branchId: string | null,
    id: string,
  ): Promise<PayStatementView> {
    return statementView(await this.findVisible(access, branchId, id));
  }

  /**
   * Recompute one draft or disputed statement from today's data. 409
   * `PAYOUT_STATEMENT_NOT_EDITABLE` once it has been sent or accepted.
   */
  async recalculate(
    access: AccessContext,
    branchId: string | null,
    id: string,
  ): Promise<PayStatementView> {
    const doc = await this.findVisible(access, branchId, id);
    const notEditable = () =>
      new ConflictException({
        code: PAYOUT_STATEMENT_NOT_EDITABLE,
        message:
          'This statement has been sent, so it can no longer be recalculated.',
      });
    if (!isEditableStatementStatus(doc.status)) throw notEditable();
    const done = await recomputeStatement(this.models, {
      agencyId: agencyOf(access),
      statementId: id,
    });
    if (!done) throw notEditable();
    return this.detail(access, branchId, id);
  }

  /**
   * The figures the manager enters (2026 comp plans) — compliance rate,
   * retention, life referrals, meeting attendance — saved whole, then the
   * statement is recalculated as Recalculate does: against the month's stored
   * team split and Salesperson of the Month. When the figures change who
   * shares the pool or can win the month, the statement says to recalculate
   * the month.
   *
   * Draft and disputed statements only (409 `PAYOUT_STATEMENT_NOT_EDITABLE`).
   * Not on one's own statement without `agency:payouts:admin` (403
   * `PAYOUT_STATEMENT_OWN_INPUTS`): they decide one's own pay.
   */
  async updateInputs(
    access: AccessContext,
    branchId: string | null,
    id: string,
    dto: UpdateStatementInputsDto,
  ): Promise<PayStatementView> {
    const doc = await this.findVisible(access, branchId, id);
    if (
      String(doc.userId) === access.userId &&
      !access.permissions.includes(AgencyPermission.PayoutsAdmin)
    ) {
      throw new ForbiddenException({
        code: PAYOUT_STATEMENT_OWN_INPUTS,
        message: 'Someone else enters the figures on your own statement.',
      });
    }
    const notEditable = () =>
      new ConflictException({
        code: PAYOUT_STATEMENT_NOT_EDITABLE,
        message:
          'This statement has been sent, so its figures can no longer change.',
      });
    if (!isEditableStatementStatus(doc.status)) throw notEditable();
    const saved = await this.models.payStatement.updateOne(
      {
        _id: doc._id,
        status: { $in: [...EDITABLE_PAY_STATEMENT_STATUSES] },
      },
      {
        $set: {
          inputs: {
            compliancePercent: dto.compliancePercent,
            retentionPercent: dto.retentionPercent,
            lifeReferrals: dto.lifeReferrals,
            meetingAttendance: dto.meetingAttendance,
          },
        },
      },
    );
    if (saved.matchedCount !== 1) throw notEditable();
    const done = await recomputeStatement(this.models, {
      agencyId: agencyOf(access),
      statementId: id,
    });
    if (!done) throw notEditable();
    return this.detail(access, branchId, id);
  }
}
