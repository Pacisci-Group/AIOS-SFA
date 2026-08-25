import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Activity,
  ActivityDocument,
} from '../../activities/schemas/activity.schema';
import { TransactionRunner } from '../../common/mongo/transaction.runner';
import { Lead, LeadDocument } from '../schemas/lead.schema';
import { buildSubmissionToken } from './intake.normalize';
import {
  IntakeContext,
  IntakeInput,
  IntakeOutcome,
  ResolvedContact,
  StepDeps,
} from './intake.types';
import { LinkEntitiesStep } from './link-entities.step';
import { ResolveContactStep } from './resolve-contact.step';
import { ResolveHouseholdStep } from './resolve-household.step';
import { ResolveLeadStep } from './resolve-lead.step';

/** Mongo duplicate-key error. */
const DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  );
}

/**
 * The lead-intake pipeline (PAC-37) — a port of legacy `processNewLead`.
 *
 * Both entry points (`POST /leads` and the public `POST /public/leads/:token`)
 * call this and nothing else. It takes all tenancy from {@link IntakeContext},
 * so the public path cannot be influenced by its own request body.
 */
@Injectable()
export class LeadIntakeService {
  private readonly logger = new Logger(LeadIntakeService.name);

  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Activity.name)
    private readonly activityModel: Model<ActivityDocument>,
    private readonly transactions: TransactionRunner,
    private readonly contacts: ResolveContactStep,
    private readonly households: ResolveHouseholdStep,
    private readonly leads: ResolveLeadStep,
    private readonly links: LinkEntitiesStep,
  ) {}

  async process(
    ctx: IntakeContext,
    input: IntakeInput,
  ): Promise<IntakeOutcome> {
    const token = buildSubmissionToken(
      ctx.channel,
      input.submissionToken,
      ctx.shareLinkId?.toString(),
    );

    // Probe BEFORE opening a transaction. Legacy only checked its token at
    // step 3, so a replay had already run contact resolution and could create a
    // contact before discovering the lead existed.
    if (token) {
      const replay = await this.findByToken(ctx.agencyId, token);
      if (replay) return replay;
    }

    try {
      const outcome = await this.transactions.run(async (session, created) => {
        const deps: StepDeps = { ctx, session, created };

        /*
         * A pinned household is resolved FIRST, inverting the usual
         * contact → household order: it is what narrows contact matching, so it
         * has to exist before step 1 runs. See `IntakeInput.householdId`.
         */
        const pinned = input.householdId
          ? await this.households.pin(input.householdId, deps)
          : null;

        const contact = await this.contacts.run(
          input.primaryContact,
          'primary',
          deps,
          pinned?.householdId,
        );
        const household =
          pinned ?? (await this.households.run(contact, input, deps));
        const lead = await this.leads.run(
          input,
          {
            contactId: contact.contactId,
            householdId: household.householdId,
            token,
            householdPinned: pinned !== null,
          },
          deps,
        );
        const members = await this.resolveMembers(
          input,
          deps,
          pinned?.householdId,
        );

        await this.links.run(
          {
            contactId: contact.contactId,
            householdId: household.householdId,
            householdIsNew: household.isNew,
            leadId: lead.leadId,
            leadIsNew: lead.isNew,
            memberContactIds: members,
          },
          deps,
        );

        if (lead.isNew) {
          await this.assignProducer(lead.leadId, deps);
        }

        return {
          leadId: lead.leadId,
          leadIsNew: lead.isNew,
          contactIsNew: contact.isNew,
          householdIsNew: household.isNew,
        };
      });

      // Best-effort, post-commit: the lead is already saved, so failing to write
      // a timeline entry must not report the whole intake as failed.
      // (Same precedent as DealAuditsService.resolveItem.)
      await this.recordCreatedActivity(ctx, outcome);
      return outcome;
    } catch (error) {
      // A concurrent duplicate submit — two in-flight requests with the same
      // token — loses the race on the unique `{agencyId, submissionToken}`
      // index. This CANNOT be handled inside the transaction: E11000 is not a
      // transient error, so `withTransaction` does not retry it and the session
      // is already aborted by the time we see it. Re-reading here is what makes
      // "a double-submit creates one lead" true under real concurrency rather
      // than only for a sequential retry.
      if (isDuplicateKeyError(error) && token) {
        const winner = await this.findByToken(ctx.agencyId, token);
        if (winner) return winner;
      }
      throw error;
    }
  }

  /**
   * Resolve additional household members, each as its own contact.
   *
   * `householdId` is the pin, threaded through for the same reason the primary
   * contact gets it: a spouse named "Sam Rivera" must match the Sam already in
   * *this* household, not one in someone else's.
   */
  private async resolveMembers(
    input: IntakeInput,
    deps: StepDeps,
    householdId?: Types.ObjectId,
  ): Promise<Types.ObjectId[]> {
    const resolved: Types.ObjectId[] = [];
    for (const member of input.members) {
      const contact: ResolvedContact = await this.contacts.run(
        member,
        member.role,
        deps,
        householdId,
      );
      resolved.push(contact.contactId);
    }
    return resolved;
  }

  /**
   * Step 5 — assignment.
   *
   * Conditional on `producerId` being unset, so "never reassign a lead that
   * already has a producer" holds as a database-level invariant rather than
   * only as the `lead.isNew` policy check at the call site. Both are kept: the
   * caller's guard expresses intent, this makes it true under concurrency.
   *
   * Round-robin is deliberately absent (PAC-53). `ctx.producerId` is always set
   * — the current user for manual entry, the link's producer for a share-link
   * submission — so there is no unassigned case.
   */
  private async assignProducer(
    leadId: Types.ObjectId,
    deps: StepDeps,
  ): Promise<void> {
    await this.leadModel.updateOne(
      { _id: leadId, producerId: { $in: [null, undefined] } },
      { $set: { producerId: deps.ctx.producerId } },
      deps.session ? { session: deps.session } : {},
    );
  }

  private async findByToken(
    agencyId: string,
    token: string,
  ): Promise<IntakeOutcome | null> {
    const existing = await this.leadModel
      .findOne({ agencyId, submissionToken: token })
      .select('_id');
    if (!existing) return null;
    return {
      leadId: existing._id,
      leadIsNew: false,
      contactIsNew: false,
      householdIsNew: false,
    };
  }

  private async recordCreatedActivity(
    ctx: IntakeContext,
    outcome: IntakeOutcome,
  ): Promise<void> {
    if (!outcome.leadIsNew) return;
    try {
      await this.activityModel.create({
        agencyId: ctx.agencyId,
        branchId: ctx.branchId,
        type: 'lead_created',
        subjectType: 'lead',
        leadId: outcome.leadId,
        userId: ctx.producerId,
        occurredAt: new Date(),
        summary:
          ctx.channel === 'share_link'
            ? 'Lead submitted through a share link'
            : 'Lead created',
        source: ctx.channel,
        isTestRecord: false,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record lead_created activity for lead ${outcome.leadId.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
