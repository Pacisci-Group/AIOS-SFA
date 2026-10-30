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
  RECONCILIATION_ASSIGNEE_CANNOT_SELL,
  RECONCILIATION_ASSIGNEE_CANNOT_SERVICE,
  RECONCILIATION_ASSIGNEE_ROLE_SLUGS,
  RECONCILIATION_TAB_LABELS,
  canRecordReconciliationSale,
  canSetUpReconciliationService,
  modulePermission,
  primaryReconciliationTab,
  reconciliationOutcomeKinds,
  type AccessContext,
  type ReconciliationAssignedListResponse,
  type ReconciliationAssignedRow,
  type ReconciliationAssignedRowDetail,
  type ReconciliationOptionsResponse,
  type ReconciliationRowView,
} from '@sfa/shared';
import { Types, type Model } from 'mongoose';
import {
  Carrier,
  type CarrierDocument,
} from '../carriers/schemas/carrier.schema';
import { clientAgencyId } from '../common/access/client-scope';
import {
  currentRunIds,
  openAssignmentsFilter,
} from '../common/carrier-reconciliation/assignment-scope';
import {
  isPendingServiceIntake,
  type RowAssignment,
} from '../common/carrier-reconciliation/carry-forward';
import { asksForDecision } from '../common/carrier-reconciliation/reconcile';
import { displayName, displayNamesFor } from '../common/domain/user-names';
import { notificationRequested } from '../inngest/events';
import { InngestService } from '../inngest/inngest.service';
import { PermissionsService } from '../permissions/permissions.service';
import {
  activeRoleHolders,
  type RoleHolderModels,
} from '../permissions/role-holders';
import { UserRole } from '../permissions/schemas/user-role.schema';
import {
  AgencyRole,
  type AgencyRoleDocument,
} from '../roles/schemas/agency-role.schema';
import { Agency, type AgencyDocument } from '../platform/schemas/agency.schema';
import { User, type UserDocument } from '../users/schemas/user.schema';
import type {
  AssignedQueryDto,
  AssignRowDto,
} from './dto/carrier-reconciliation.dto';
import { noLiveHandOffClaim, outcomeAsRead } from './outcome-filters';
import {
  isStale,
  reconciliationPrefill,
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
 *
 * ## Outcomes (PAC-173 PR 4)
 *
 * The assignee records what became of the row (`ReconciliationOutcomesService`).
 * Two rules land here:
 *
 * - A row **missing from the app** goes only to someone who can book a sale
 *   (`canRecordReconciliationSale`: `leads:write` + `deal_audits:write`), by
 *   their effective permissions rather than their role — a CSR an agency lets
 *   sell qualifies, a standard one does not (owner, 28 Oct 2026). The picker
 *   marks who can.
 * - Handing the row to someone else, or taking it back, **clears an outcome
 *   still in progress**: the new person starts over, because the first one's
 *   lead stays in their own pipeline. A note change for the same person keeps
 *   it, and a finished outcome is a record either way.
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
    @InjectModel(Carrier.name)
    private readonly carrierModel: Model<CarrierDocument>,
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
    private readonly inngest: InngestService,
    /**
     * Effective permissions, for who may be given a row: a `missing_from_app`
     * one needs someone who can book a sale, a 1-800 one someone who can set
     * it up for service.
     */
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * The assignee picker: the agency's active Producers and CSRs, by name,
   * each marked with whether they can book a sale — only they can be given a
   * row missing from the app — and whether they can set a 1-800 policy up for
   * service, which a Dash-only 1-800 row needs.
   */
  async options(access: AccessContext): Promise<ReconciliationOptionsResponse> {
    const agencyId = clientAgencyId(access);
    const holders = await activeRoleHolders(
      this.roleHolderModels(),
      agencyId,
      RECONCILIATION_ASSIGNEE_ROLE_SLUGS,
    );
    const can = await this.whoCan(
      agencyId,
      holders.map((user) => user._id),
    );
    return {
      assignees: holders.map((user) => ({
        id: String(user._id),
        name: displayName(user),
        email: user.email ?? '',
        roles: user.roles,
        canRecordSale: can.get(String(user._id))?.sell ?? false,
        canSetUpService: can.get(String(user._id))?.service ?? false,
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
   *
   * A row missing from the app goes only to someone who can book a sale (400
   * `RECONCILIATION_ASSIGNEE_CANNOT_SELL`). A new assignee, or none, clears
   * an outcome still in progress in the same write.
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
        if (row.tabs.includes('missing_from_app')) {
          await this.assertCanRecordSale(agencyId, dto.userId);
        }
        if (reconciliationOutcomeKinds(row).includes('service_intake')) {
          await this.assertCanSetUpService(agencyId, dto.userId);
        }
        next = {
          userId: dto.userId,
          assignedById: access.userId,
          assignedAt: new Date(),
          note: dto.note || null,
        };
      }
    }

    // The person changes (or nobody has it now): an outcome they had under
    // way goes with them. Their lead stays theirs; the next person starts
    // over. A finished outcome is the record of what was done — it stays.
    const clearsOutcome =
      next?.userId !== current?.userId && row.outcome?.status === 'in_progress';
    // A 1-800 service intake still waiting on its welcome call (PAC-173 PR 5)
    // goes only while nobody is opening the call, and the row then asks what
    // its own tabs do.
    const clearsPending = clearsOutcome && isPendingServiceIntake(row.outcome);

    // Compare-and-swap on the assignment just read: two people assigning the
    // same row at once must not both believe they won, or the loser's
    // assignee is notified about a row that is with someone else. The
    // outcome is in the match too, so one the assignee started meanwhile is
    // not handed to someone else half-done.
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
          ...outcomeAsRead(row.outcome),
          ...(clearsPending ? noLiveHandOffClaim() : {}),
        },
        {
          $set: clearsOutcome
            ? {
                assignment: next,
                outcome: null,
                ...(clearsPending
                  ? { needsReview: asksForDecision(row.tabs) }
                  : {}),
              }
            : { assignment: next },
        },
        { new: true },
      )
      .lean<LeanRow>();
    if (!updated) {
      throw new ConflictException(
        'Someone else changed who this row is with, or what is recorded on it. Reload it and try again.',
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
   *
   * Carries the Dash line as the New Lead and Sold forms want it (`prefill`),
   * for the assignee who records it as sold.
   */
  async detail(
    access: AccessContext,
    rowId: string,
  ): Promise<ReconciliationAssignedRowDetail> {
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
    return this.assignedDetail(agencyId, row);
  }

  /**
   * One assigned row as `GET assigned/:rowId` answers it — the view, the
   * upload it came from, and the prefill. Shared with the outcome endpoint,
   * which answers with the row it just wrote.
   */
  async assignedDetail(
    agencyId: string,
    row: LeanRow,
  ): Promise<ReconciliationAssignedRowDetail> {
    const offersServiceIntake =
      reconciliationOutcomeKinds(row).includes('service_intake');
    const [[view], carrierName, crmServiceOn] = await Promise.all([
      this.assignedViews(agencyId, [row]),
      this.runCarrierName(agencyId, row.runId),
      offersServiceIntake ? this.crmServiceOn(agencyId) : false,
    ]);
    if (!view) throw new NotFoundException('That row is not assigned to you.');
    return {
      ...view,
      // A service intake ends in a CSR's welcome call, so it is offered only
      // where CRM service is on: `serviceIntake: null` is how the page knows.
      prefill: reconciliationPrefill(row.dash, carrierName, {
        offersServiceIntake: offersServiceIntake && crmServiceOn,
      }),
    };
  }

  /**
   * Whether the agency has CRM service on — the welcome call a service intake
   * opens lives there, and the assignee controller's own gate is Dash
   * Reconciliation only.
   */
  async crmServiceOn(agencyId: string): Promise<boolean> {
    const agency = await this.agencyModel
      .findById(agencyId)
      .select('modules')
      .lean<{ modules?: Record<string, { enabled?: boolean }> }>();
    return agency?.modules?.[ModuleKey.CrmService]?.enabled === true;
  }

  /** The catalog name of the carrier a run was uploaded for. */
  async carrierNameOfRun(
    agencyId: string,
    runId: Types.ObjectId,
  ): Promise<string | null> {
    return this.runCarrierName(agencyId, runId);
  }

  /**
   * The row as the agency's current run of the same report has it: `row`
   * itself unless a re-upload replaced its run (perhaps more than once), then
   * the row with its key on the newest run, or `null` if that file dropped it.
   *
   * Public for the sale hook, which is handed whatever row id the page held.
   */
  async currentCopy(agencyId: string, row: LeanRow): Promise<LeanRow | null> {
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

  /** 400 unless `userId` can book a sale — a `missing_from_app` row's rule. */
  private async assertCanRecordSale(
    agencyId: string,
    userId: string,
  ): Promise<void> {
    const can = await this.whoCan(agencyId, [new Types.ObjectId(userId)]);
    if (!can.get(userId)?.sell) {
      throw new BadRequestException({
        code: RECONCILIATION_ASSIGNEE_CANNOT_SELL,
        message:
          'A Dash sale missing from the app can be given only to someone who can book a sale (create leads and record sales).',
      });
    }
  }

  /** 400 unless `userId` can set a 1-800 policy up for service — a Dash-only 1-800 row's rule. */
  private async assertCanSetUpService(
    agencyId: string,
    userId: string,
  ): Promise<void> {
    const can = await this.whoCan(agencyId, [new Types.ObjectId(userId)]);
    if (!can.get(userId)?.service) {
      throw new BadRequestException({
        code: RECONCILIATION_ASSIGNEE_CANNOT_SERVICE,
        message:
          'A 1-800 policy the app does not have can be given only to someone who can set it up for service (create leads).',
      });
    }
  }

  /**
   * What each of these users can do with a row — book a sale, set a 1-800
   * policy up for service — by their **effective** permissions: role defaults
   * plus their own grants, less revokes, within the agency's enabled modules;
   * never by role name. One resolve per person: the picker lists a handful of
   * Producers and CSRs.
   */
  private async whoCan(
    agencyId: string,
    userIds: readonly Types.ObjectId[],
  ): Promise<Map<string, { sell: boolean; service: boolean }>> {
    if (!userIds.length) return new Map();
    const users = await this.userModel
      .find({
        _id: { $in: [...userIds] },
        agencyId: new Types.ObjectId(agencyId),
      })
      .select('agencyId isPlatformAdmin');
    const verdicts = await Promise.all(
      users.map(async (user) => {
        const permissions = await this.permissions.resolveForUser(user);
        return [
          String(user._id),
          {
            sell: canRecordReconciliationSale(permissions),
            service: canSetUpReconciliationService(permissions),
          },
        ] as const;
      }),
    );
    return new Map(verdicts);
  }

  /** The catalog name of the carrier a run was uploaded for. */
  private async runCarrierName(
    agencyId: string,
    runId: Types.ObjectId,
  ): Promise<string | null> {
    const run = await this.runModel
      .findOne({ _id: runId, agencyId }, { carrierId: 1 })
      .lean<Pick<LeanRun, 'carrierId'>>();
    if (!run?.carrierId) return null;
    const carrier = await this.carrierModel
      .findById(run.carrierId, { name: 1 })
      .lean<{ name?: string }>();
    return carrier?.name ?? null;
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
