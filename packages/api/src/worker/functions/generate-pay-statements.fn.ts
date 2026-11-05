import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ModuleKey } from '@sfa/shared';
import { cron } from 'inngest';
import { Model, Types } from 'mongoose';
import {
  Branch,
  type BranchDocument,
} from '../../branches/schemas/branch.schema';
import { Carrier } from '../../carriers/schemas/carrier.schema';
import { Chargeback } from '../../chargebacks/schemas/chargeback.schema';
import { DEFAULT_AGENCY_TIME_ZONE } from '../../common/dates/time-zones';
import {
  generateRun,
  type PayoutModels,
} from '../../common/payouts/generate-run';
import {
  monthWindow,
  previousMonthIn,
} from '../../common/payouts/month-window';
import { claimRun } from '../../common/payouts/run-claim';
import {
  runReadyNotification,
  runReadyRecipients,
} from '../../common/payouts/run-ready';
import { Contact } from '../../contacts/schemas/contact.schema';
import { DealAudit } from '../../deal-audits/schemas/deal-audit.schema';
import { Deal } from '../../deals/schemas/deal.schema';
import { Household } from '../../households/schemas/household.schema';
import { notificationRequested } from '../../inngest/events';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';
import {
  deterministicEventId,
  InngestService,
} from '../../inngest/inngest.service';
import { LeadSource } from '../../lead-sources/schemas/lead-source.schema';
import { PaymentStructure } from '../../payouts/schemas/payment-structure.schema';
import { PayoutRun } from '../../payouts/schemas/payout-run.schema';
import { PayStatement } from '../../payouts/schemas/pay-statement.schema';
import { UserRole } from '../../permissions/schemas/user-role.schema';
import { Agency } from '../../platform/schemas/agency.schema';
import { Policy } from '../../policies/schemas/policy.schema';
import {
  AgencyRole,
  type AgencyRoleDocument,
} from '../../roles/schemas/agency-role.schema';
import { User, type UserDocument } from '../../users/schemas/user.schema';
import { forEachAgency } from '../agency-sweep';

/** Minimal surface of Inngest's `step` — see `set-users-away.fn.ts`. */
type StepLike = {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<unknown>;
};

export interface GeneratePayStatementsResult {
  /** Agencies whose month was drafted this tick. */
  drafted: number;
  /** Statements written across them. */
  statements: number;
}

type AgencyLean = {
  timezone?: string;
  modules?: Record<string, { enabled?: boolean } | undefined>;
};

/**
 * Drafts last month's pay statements on the 1st (PAC-178 §4).
 *
 * ## One cron, every agency's own midnight
 *
 * Hourly in UTC, like the end-of-day sweep: on each tick every agency asks
 * its own clock which month just ended (`previousMonthIn`), so an agency in
 * Chicago is drafted at its midnight and one in Honolulu at its. On every
 * other tick of the month the month is already drafted and the claim says
 * so — that is the "drafted once" guarantee, and a tick the worker slept
 * through is simply made up by the next one.
 *
 * ## The claim is the run
 *
 * `claimRun` upserts the month's `payoutRuns` row on its unique
 * `{agencyId, month}`: only the tick that inserted it — or took over a
 * failed or dead one — computes. A second worker or the owner's Generate at
 * the same moment gets "busy" and does nothing. A month the owner generated
 * before it ended is re-drafted once it has (draft and disputed statements
 * only), so the 1st-of-month draft always covers the whole month.
 *
 * Only agencies with the Payouts module on and at least one structure with
 * members are drafted. Owners and branch managers are told
 * (`payouts.run_ready`, once per run). The statements stay drafts: nothing
 * reaches an employee until someone sends it (PAC-181).
 */
@Injectable()
@InngestFunction()
export class GeneratePayStatementsFn implements InngestFunctionProvider {
  private readonly logger = new Logger(GeneratePayStatementsFn.name);
  private readonly models: PayoutModels;

  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    private readonly events: InngestService,
    @InjectModel(Agency.name) private readonly agencyModel: Model<Agency>,
    @InjectModel(Deal.name) deal: Model<Deal>,
    @InjectModel(Policy.name) policy: Model<Policy>,
    @InjectModel(Chargeback.name) chargeback: Model<Chargeback>,
    @InjectModel(DealAudit.name) dealAudit: Model<DealAudit>,
    @InjectModel(Household.name) household: Model<Household>,
    @InjectModel(Contact.name) contact: Model<Contact>,
    @InjectModel(Carrier.name) carrier: Model<Carrier>,
    @InjectModel(LeadSource.name) leadSource: Model<LeadSource>,
    @InjectModel(PaymentStructure.name)
    paymentStructure: Model<PaymentStructure>,
    @InjectModel(PayoutRun.name) payoutRun: Model<PayoutRun>,
    @InjectModel(PayStatement.name) payStatement: Model<PayStatement>,
    @InjectModel(User.name) user: Model<UserDocument>,
    @InjectModel(AgencyRole.name) role: Model<AgencyRoleDocument>,
    @InjectModel(UserRole.name) userRole: Model<UserRole>,
    @InjectModel(Branch.name) branch: Model<BranchDocument>,
  ) {
    this.models = {
      agency: agencyModel,
      deal,
      policy,
      chargeback,
      dealAudit,
      household,
      contact,
      carrier,
      leadSource,
      paymentStructure,
      payoutRun,
      payStatement,
      user,
      role,
      userRole,
      branch,
    };
  }

  build() {
    return this.inngest.createFunction(
      {
        id: 'generate-pay-statements',
        name: "Draft last month's pay statements",

        /**
         * Hourly, in UTC: every agency's midnight lands on some hour (the
         * quarter-hour zones a few minutes late), and the claim makes every
         * other tick of the month a no-op.
         */
        triggers: [cron('0 * * * *')],

        /** One at a time: the claim makes an overlap safe, a serial run keeps the log honest. */
        concurrency: { limit: 1 },

        /**
         * No retries. A failed month is marked `failed` and the next tick,
         * an hour away, claims it again from current data.
         */
        retries: 0,
      },
      ({ step }) => this.handle(step),
    );
  }

  /** Lifted out of `createFunction` so tests can call it with any `now`. */
  async handle(
    step: StepLike,
    now: Date = new Date(),
  ): Promise<GeneratePayStatementsResult> {
    const result = (await step.run('generate-pay-statements', async () => {
      let drafted = 0;
      let statements = 0;
      const sweep = await forEachAgency(
        this.agencyModel,
        this.logger,
        async (agencyId) => {
          const written = await this.draftAgency(agencyId, now);
          if (written !== null) {
            drafted += 1;
            statements += written;
          }
        },
      );
      return { drafted, statements, ...sweep };
    })) as GeneratePayStatementsResult & { swept: number; failed: number };

    if (result.drafted > 0) {
      this.logger.log(
        `Drafted ${result.statements} pay statement(s) across ${result.drafted} ` +
          `agenc${result.drafted === 1 ? 'y' : 'ies'}`,
      );
    }
    if (result.failed > 0) {
      this.logger.warn(
        `${result.failed} agency month(s) failed to draft; the next tick tries again`,
      );
    }
    return { drafted: result.drafted, statements: result.statements };
  }

  /** One agency: `null` when there was nothing to draft, else the statement count. */
  private async draftAgency(
    agencyOid: Types.ObjectId,
    now: Date,
  ): Promise<number | null> {
    const agencyId = String(agencyOid);
    const agency = await this.agencyModel
      .findById(agencyOid)
      .select({ timezone: 1, modules: 1 })
      .lean<AgencyLean | null>();
    if (!agency || agency.modules?.[ModuleKey.Payouts]?.enabled !== true) {
      return null;
    }
    const staffed = await this.models.paymentStructure.exists({
      agencyId,
      status: 'active',
      'memberIds.0': { $exists: true },
    });
    if (!staffed) return null;

    const timeZone = agency.timezone ?? DEFAULT_AGENCY_TIME_ZONE;
    const month = previousMonthIn(timeZone, now);
    const claim = await claimRun(this.models.payoutRun, {
      agencyId,
      month,
      trigger: 'cron',
      timeZone,
      window: monthWindow(month, timeZone),
      actorId: null,
      now,
    });
    if (claim.outcome !== 'claimed') return null;

    const run = await generateRun(this.models, {
      runId: claim.runId,
      agencyId,
      now,
    });
    await this.notify(agencyId, run.runId, month, run.statements);
    return run.statements;
  }

  /** Best effort: a lost notification must not fail a drafted month. */
  private async notify(
    agencyId: string,
    runId: string,
    month: string,
    statements: number,
  ): Promise<void> {
    try {
      const recipientIds = await runReadyRecipients(
        {
          roleModel: this.models.role,
          userRoleModel: this.models.userRole,
          userModel: this.models.user,
        },
        agencyId,
      );
      if (!recipientIds.length) return;
      await this.events.send(
        notificationRequested,
        runReadyNotification({
          agencyId,
          runId,
          month,
          statements,
          recipientIds,
        }),
        { id: deterministicEventId('payouts.run_ready', runId) },
      );
    } catch (error) {
      this.logger.warn(
        `Could not request the run-ready notification for run ${runId}: ${String(error)}`,
      );
    }
  }
}
