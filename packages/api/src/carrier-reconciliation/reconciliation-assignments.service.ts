import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ModuleKey,
  RECONCILIATION_ASSIGNEE_ROLE_SLUGS,
  RECONCILIATION_TAB_LABELS,
  modulePermission,
  primaryReconciliationTab,
  type AccessContext,
  type ReconciliationAssignedListResponse,
  type ReconciliationAssignedRow,
  type ReconciliationOptionsResponse,
  type ReconciliationRowView,
} from '@sfa/shared';
import { Types, type Model } from 'mongoose';
import { clientAgencyId } from '../common/access/client-scope';
import {
  currentRunIds,
  openAssignmentsFilter,
} from '../common/carrier-reconciliation/assignment-scope';
import type { RowAssignment } from '../common/carrier-reconciliation/carry-forward';
import { displayName, displayNamesFor } from '../common/domain/user-names';
import { notificationRequested } from '../inngest/events';
import { InngestService } from '../inngest/inngest.service';
import {
  activeRoleHolders,
  type RoleHolderModels,
} from '../permissions/role-holders';
import { UserRole } from '../permissions/schemas/user-role.schema';
import {
  AgencyRole,
  type AgencyRoleDocument,
} from '../roles/schemas/agency-role.schema';
import { User, type UserDocument } from '../users/schemas/user.schema';
import type {
  AssignedQueryDto,
  AssignRowDto,
} from './dto/carrier-reconciliation.dto';
import {
  isStale,
  resolveRowViews,
  type LeanRow,
  type LeanRun,
} from './reconciliation-views';
import {
  ReconciliationRow,
  type ReconciliationRowDocument,
} from './schemas/reconciliation-row.schema';
import {
  ReconciliationRun,
  type ReconciliationRunDocument,
} from './schemas/reconciliation-run.schema';

const READ = modulePermission(ModuleKey.CarrierReconciliation, 'read');

/**
 * Handing Dash rows to people (PAC-173): the owner assigns a row that needs
 * a decision to one of the agency's **Producers or CSRs**, who is notified
 * and works it from their own page.
 *
 * The assignment is its own field on the row (`assignment`), never part of
 * `review`: saving a decision replaces `review` whole and must not drop who
 * the row is with. A decided row keeps its assignee — that is the record of
 * who worked it — but leaves their list.
 *
 * The assignee's reads are not gated on `carrier_reconciliation:read`, which
 * no Producer or CSR holds: they see the rows assigned to **them** and
 * nothing else of the report.
 */
@Injectable()
export class ReconciliationAssignmentsService {
  private readonly logger = new Logger(ReconciliationAssignmentsService.name);

  constructor(
    @InjectModel(ReconciliationRun.name)
    private readonly runModel: Model<ReconciliationRunDocument>,
    @InjectModel(ReconciliationRow.name)
    private readonly rowModel: Model<ReconciliationRowDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(AgencyRole.name)
    private readonly roleModel: Model<AgencyRoleDocument>,
    @InjectModel(UserRole.name)
    private readonly userRoleModel: Model<UserRole>,
    private readonly inngest: InngestService,
  ) {}

  /** The assignee picker: the agency's active Producers and CSRs, by name. */
  async options(access: AccessContext): Promise<ReconciliationOptionsResponse> {
    const holders = await activeRoleHolders(
      this.roleHolderModels(),
      clientAgencyId(access),
      RECONCILIATION_ASSIGNEE_ROLE_SLUGS,
    );
    return {
      assignees: holders.map((user) => ({
        id: String(user._id),
        name: displayName(user),
        email: user.email ?? '',
        roles: user.roles,
      })),
    };
  }

  /**
   * Assign a row to someone (`userId`), change the note on it, or take it
   * back (`null`). Only a row still waiting on a decision, on a run nobody
   * re-uploaded, can be handed to anyone; taking one back always works.
   *
   * The new assignee is notified (in-app + push) after the write, best-effort
   * — the event outbox replays a failed send — and never for a note change,
   * an unassign, or a row the owner gives themselves.
   */
  async assign(
    access: AccessContext,
    runId: string,
    rowId: string,
    dto: AssignRowDto,
  ): Promise<ReconciliationRowView> {
    const agencyId = clientAgencyId(access);
    const run = await this.runModel
      .findOne({ _id: new Types.ObjectId(runId), agencyId })
      .lean<LeanRun>();
    if (!run) throw new NotFoundException('Reconciliation run not found.');
    const row = await this.rowModel
      .findOne({ _id: new Types.ObjectId(rowId), agencyId, runId: run._id })
      .lean<LeanRow>();
    if (!row) throw new NotFoundException('Row not found.');

    // Taking a row back on a replaced run would clear only this copy: the
    // re-upload carried the assignment to its own row, which is the one the
    // assignee's page reads. So both ways, the change belongs on that run.
    if (run.supersededByRunId) {
      throw new ConflictException(
        'A newer upload of this report replaced this run. Change who has the row there.',
      );
    }
    const current = row.assignment ?? null;
    let next: RowAssignment | null = null;
    if (dto.userId) {
      if (run.status !== 'ready' || isStale(run)) {
        throw new ConflictException(
          'Only the rows of a finished run can be assigned.',
        );
      }
      if (!row.needsReview || row.review.status !== 'open') {
        throw new ConflictException(
          'Only a row still waiting on a decision can be assigned.',
        );
      }
      if (current?.userId === dto.userId) {
        next = {
          ...current,
          note: dto.note === undefined ? current.note : dto.note || null,
        };
      } else {
        await this.assertAssignable(agencyId, dto.userId);
        next = {
          userId: dto.userId,
          assignedById: access.userId,
          assignedAt: new Date(),
          note: dto.note || null,
        };
      }
    }

    // Compare-and-swap on the assignment just read: two people assigning the
    // same row at once must not both believe they won, or the loser's
    // assignee is notified about a row that is with someone else.
    const updated = await this.rowModel
      .findOneAndUpdate(
        {
          _id: row._id,
          agencyId,
          ...(current
            ? {
                'assignment.userId': current.userId,
                'assignment.assignedAt': current.assignedAt,
              }
            : { assignment: null }),
        },
        { $set: { assignment: next } },
        { new: true },
      )
      .lean<LeanRow>();
    if (!updated) {
      throw new ConflictException(
        'Someone else changed who this row is with. Reload it and try again.',
      );
    }

    if (
      next &&
      next.userId !== current?.userId &&
      next.userId !== access.userId
    ) {
      await this.notifyAssignee(access, agencyId, updated, next);
    }
    const [view] = await resolveRowViews(this.userModel, [updated]);
    return view;
  }

  /**
   * The rows assigned to the caller that still wait on a decision, oldest
   * hand-off first, across the agency's current runs. Someone who can read
   * the whole report may ask for another person's (`userId`).
   */
  async list(
    access: AccessContext,
    query: AssignedQueryDto,
  ): Promise<ReconciliationAssignedListResponse> {
    const agencyId = clientAgencyId(access);
    const userId = query.userId ?? access.userId;
    if (userId !== access.userId && !access.permissions.includes(READ)) {
      throw new ForbiddenException(
        'You can only see the Dash rows assigned to you.',
      );
    }
    const filter = openAssignmentsFilter(
      agencyId,
      userId,
      await currentRunIds(this.runModel, agencyId),
    );
    const [rows, total] = await Promise.all([
      this.rowModel
        .find(filter)
        .sort({ 'assignment.assignedAt': 1, _id: 1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<LeanRow[]>(),
      this.rowModel.countDocuments(filter),
    ]);
    return {
      items: await this.assignedViews(agencyId, rows),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /**
   * One assigned row — what a notification opens. Returned even once it has
   * been decided, so an old notification still shows what happened; 404 to
   * anyone it is not assigned to, unless they can read the whole report.
   *
   * A notification names the row on the upload it was assigned on. When a
   * re-upload of the same report has replaced that run since, the answer is
   * the **current** copy of the row (same key): the old one is frozen history
   * and would still read "open, assigned to you" after the row was decided or
   * handed to someone else on the new run. No current copy, or one that is
   * no longer theirs, is a 404.
   */
  async detail(
    access: AccessContext,
    rowId: string,
  ): Promise<ReconciliationAssignedRow> {
    const agencyId = clientAgencyId(access);
    const asked = await this.rowModel
      .findOne({ _id: new Types.ObjectId(rowId), agencyId })
      .lean<LeanRow>();
    const row = asked ? await this.currentCopy(agencyId, asked) : null;
    const visible =
      row?.assignment &&
      (row.assignment.userId === access.userId ||
        access.permissions.includes(READ));
    if (!row || !visible) {
      throw new NotFoundException('That row is not assigned to you.');
    }
    const [view] = await this.assignedViews(agencyId, [row]);
    return view;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private roleHolderModels(): RoleHolderModels {
    return {
      roleModel: this.roleModel,
      userRoleModel: this.userRoleModel,
      userModel: this.userModel,
    };
  }

  /**
   * The row as the agency's current run of the same report has it: `row`
   * itself unless a re-upload replaced its run (perhaps more than once), then
   * the row with its key on the newest run, or `null` if that file dropped it.
   */
  private async currentCopy(
    agencyId: string,
    row: LeanRow,
  ): Promise<LeanRow | null> {
    let runId = row.runId;
    // Bounded: a chain is one link per re-upload of the same period.
    for (let hops = 0; hops < 100; hops += 1) {
      const run = await this.runModel
        .findOne({ _id: runId, agencyId }, { supersededByRunId: 1 })
        .lean<Pick<LeanRun, 'supersededByRunId'>>();
      if (!run?.supersededByRunId) break;
      runId = run.supersededByRunId;
    }
    if (String(runId) === String(row.runId)) return row;
    return this.rowModel
      .findOne({ agencyId, runId, rowKey: row.rowKey })
      .lean<LeanRow>();
  }

  /** 400 unless `userId` is an active Producer or CSR of this agency. */
  private async assertAssignable(
    agencyId: string,
    userId: string,
  ): Promise<void> {
    const [holder] = await activeRoleHolders(
      this.roleHolderModels(),
      agencyId,
      RECONCILIATION_ASSIGNEE_ROLE_SLUGS,
      { _id: new Types.ObjectId(userId) },
    );
    if (!holder) {
      throw new BadRequestException(
        'A row can be assigned only to an active Producer or CSR of this agency.',
      );
    }
  }

  private async assignedViews(
    agencyId: string,
    rows: LeanRow[],
  ): Promise<ReconciliationAssignedRow[]> {
    const [views, runs] = await Promise.all([
      resolveRowViews(this.userModel, rows),
      this.runModel
        .find(
          {
            agencyId,
            _id: { $in: [...new Set(rows.map((row) => row.runId))] },
          },
          { file: 1, fileMeta: 1, window: 1 },
        )
        .lean<Pick<LeanRun, '_id' | 'file' | 'fileMeta' | 'window'>[]>(),
    ]);
    const runById = new Map(runs.map((run) => [String(run._id), run]));
    return views.flatMap((view) => {
      const run = runById.get(view.runId);
      if (!view.assignment || !run) return [];
      return [
        {
          ...view,
          assignment: view.assignment,
          run: {
            id: view.runId,
            filename: run.file.filename,
            startDate: run.window?.from ?? run.fileMeta.startDate,
            endDate: run.window?.to ?? run.fileMeta.endDate,
          },
        },
      ];
    });
  }

  /**
   * One push per hand-off. The key names the assignee and the moment, so a
   * retried send is the same notification, while assigning the row away and
   * back later is a new one (the inbox keeps a key forever).
   */
  private async notifyAssignee(
    access: AccessContext,
    agencyId: string,
    row: LeanRow,
    assignment: RowAssignment,
  ): Promise<void> {
    const rowId = String(row._id);
    try {
      const names = await displayNamesFor(this.userModel, [access.userId]);
      const tab = primaryReconciliationTab(row.tabs);
      await this.inngest.send(notificationRequested, {
        type: 'reconciliation.row_assigned',
        recipientIds: [assignment.userId],
        agencyId,
        actorId: access.userId,
        entity: { kind: 'reconciliationRow', id: rowId },
        data: {
          rowId,
          runId: String(row.runId),
          policyNumber: row.dash?.policyNumber ?? row.app?.policyNumber ?? null,
          customerName: row.dash?.customerName ?? row.app?.clientName ?? null,
          tabLabel: tab ? RECONCILIATION_TAB_LABELS[tab] : null,
          assignerName: names.get(access.userId) ?? null,
        },
        dedupeKey: `reconciliation.row_assigned:${rowId}:${assignment.userId}:${assignment.assignedAt.getTime()}`,
      });
    } catch (err) {
      this.logger.warn(
        `Could not request the assignment notification for row ${rowId}: ${String(err)}`,
      );
    }
  }
}
