import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  RETIRED_POLICY_STATUS,
  normalizePolicyStatus,
  rewriteFinancialOutcome,
} from '@sfa/shared';
import type {
  AccessContext,
  PolicyReplacementChain,
  PolicyReplacementChainEntry,
  PolicyReplacementReason,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  Chargeback,
  ChargebackDocument,
} from '../chargebacks/schemas/chargeback.schema';
import { authorshipForInsert } from '../common/context/request-context';
import { sessionOptions } from '../sold-deals/intake/sold-intake.types';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import {
  Lead,
  LeadDocument,
  type LeadReplacementIntentDoc,
} from '../leads/schemas/lead.schema';
import type { SoldDealIntakeService } from '../sold-deals/intake/sold-deal-intake.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { PoliciesService } from './policies.service';
import { Policy, PolicyDocument } from './schemas/policy.schema';

/**
 * What a replacement costs, and what it did — the half of Cancel Rewrite and
 * Company Transfer that is **not** writing the policy.
 *
 * Writing the policy is the Sold form's job. Both replacements run through it
 * on a lead created for them (PAC-126), and `UpsertPoliciesStep` retires the
 * old policy and links the pair from the `fromPolicyId` the sold path injects.
 * What remains here is everything the ordinary sale does *not* do:
 *
 *   - {@link recordForLead} — inside the sale's own transaction, the chargeback
 *     on a rewrite and the stamp that marks the lead's intent consumed.
 *   - {@link replacementChain} — the read: every policy that led to this one
 *     and every one that came after, with what each cancellation cost.
 *
 * ## The money
 *
 * `rewriteFinancialOutcome` is the one authority. A rewrite always charges the
 * cancelled policy's premium back; inside a calendar month of the original sale
 * it also reverses the producer's credit. A transfer charges nothing — the
 * client moved within our own book, and nothing was sold.
 *
 * ## What used to be here
 *
 * `POST /policies/:id/rewrite` and its presign, which wrote the replacement
 * from a bespoke endpoint anchored on the policy. Retired along with the
 * ticket-anchored transfer: two more ways to write a policy, each with its own
 * upload prefix, its own guards and its own drift. A policy needs the same
 * information to exist however it came about, and the Sold form is where that
 * information is collected.
 *
 * ## The invariant
 *
 * **A policy cannot be `Cancel Rewrite` or `Company Transfer` without a
 * replacement.** The only code that writes either status is
 * `UpsertPoliciesStep.retireTransferred`, in the same transaction as the
 * replacement it retires for, and `PATCH /policies/:id` rejects both outright.
 */
@Injectable()
export class PolicyRewritesService {
  constructor(
    @InjectModel(Policy.name)
    private readonly policyModel: Model<PolicyDocument>,
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    @InjectModel(Chargeback.name)
    private readonly chargebackModel: Model<ChargebackDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    /*
     * The replacement lead, to stamp its intent consumed in the same transaction
     * as the deal. A *schema* registration in `PoliciesModule`, not a
     * `LeadsModule` import — that module already imports this one for
     * `loadOwnedPolicy`, so importing it back would be a cycle needing
     * `forwardRef`. Registering another module's schema is the house pattern.
     */
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    private readonly policies: PoliciesService,
  ) {}

  /**
   * Finish a replacement booked through the Sold form (PAC-126).
   *
   * Called from inside `SoldDealIntakeService.process`'s transaction, after the
   * policies are written and before the commit. Two writes, both of which must
   * be in that transaction:
   *
   *   1. **The chargeback**, for a Cancel Rewrite only. A Company Transfer moves
   *      a client within their own book — nothing was sold and nothing is clawed
   *      back, which is the whole difference between the two reasons.
   *   2. **Stamping the intent consumed**, which is what stops the resume path
   *      offering this lead again and what makes a second submit fall through as
   *      an ordinary sale. A replacement booked without it could be booked
   *      twice; a chargeback lost without it would take a producer's credit and
   *      never give it back. Neither would ever be noticed.
   *
   * The retire and the link are not here — `UpsertPoliciesStep` does both from
   * the `fromPolicyId` the caller injected, exactly as it does for a transfer.
   */
  async recordForLead(args: {
    deps: Parameters<
      NonNullable<Parameters<SoldDealIntakeService['process']>[4]>
    >[0];
    lead: LeadDocument;
    intent: LeadReplacementIntentDoc;
    replacementPolicyId: Types.ObjectId | null;
    dealId: Types.ObjectId;
    /**
     * The sold date from the form's first card, `YYYY-MM-DD`.
     *
     * Passed in rather than read off the context because the context does not
     * carry it, and deriving it a second time here is how the cancellation date
     * and the deal's sold date would come to disagree. On this flow they are the
     * same value by construction — there is no separate cancellation field the
     * way `POST /policies/:id/rewrite` had.
     */
    soldDate: string;
  }): Promise<void> {
    const { deps, lead, intent, replacementPolicyId, dealId, soldDate } = args;
    const agencyId = deps.ctx.agencyId;

    const cancelled = await this.policyModel
      .findOne({ _id: intent.policyId, agencyId })
      .session(deps.session);
    if (!cancelled) {
      // `UpsertPoliciesStep.retireTransferred` has already run against this id
      // and would have thrown, so reaching here means the policy vanished
      // mid-transaction. Fail rather than book a replacement for nothing.
      throw new NotFoundException('That policy could not be found.');
    }

    if (intent.reason === 'cancel_rewrite') {
      /*
       * The original deal is where the producer's credit lives, and therefore
       * what the clawback window is measured against and applied to. Null for a
       * migrated or household-only policy, which is not an error: the chargeback
       * is still recorded (the money came back either way), the window evaluates
       * false with no sold date, and there is simply no deal to reduce.
       */
      const originalDeal = cancelled.dealId
        ? await this.dealModel
            .findOne({ _id: cancelled.dealId, agencyId })
            .select('soldDate producerId premium chargebackAdjustment')
            .session(deps.session)
        : null;

      /*
       * The cancellation date is the deal's sold date — the one the rep entered
       * on the Sold form's first card. The two cannot disagree, because there is
       * only one value: this flow no longer has a separate `cancelledAt` field
       * the way `POST /policies/:id/rewrite` did.
       */
      const cancelledAt = this.resolveCancelledAt(soldDate, originalDeal);
      const outcome = rewriteFinancialOutcome(
        cancelled.premium,
        originalDeal?.soldDate ?? null,
        cancelledAt,
      );

      /*
       * The producer credited on the **original** deal carries the chargeback —
       * not whoever is processing the replacement. A CSR or a colleague writing
       * the rewrite must not be charged for a sale they never made.
       */
      const chargedProducerId = originalDeal?.producerId ?? null;

      await this.writeChargeback({
        deps,
        cancelled,
        replacementPolicyId,
        originalDeal,
        outcome,
        cancelledAt,
        producerId: chargedProducerId,
        producerName: chargedProducerId
          ? await this.actorName(String(chargedProducerId))
          : '',
      });
    }

    await this.leadModel.updateOne(
      { _id: lead._id, agencyId },
      {
        $set: {
          'replacementIntent.consumedAt': new Date(),
          'replacementIntent.consumedByDealId': dealId,
        },
      },
      sessionOptions(deps.session),
    );
  }

  /**
   * A policy's full replacement history, oldest first.
   *
   * Answers the same thing from **any** link in the chain: someone opening the
   * original policy from two rewrites ago wants the whole story, not the half
   * that happened after it. So this walks back to the root first, then forward
   * to the end, rather than starting where it was asked.
   *
   * ## Why it is a walk and not an aggregation
   *
   * A `$graphLookup` would do it in one round trip, but the chain is at most a
   * handful of links (a policy rewritten more than two or three times is a data
   * problem, not a use case) and the walk is readable. The cycle guard is the
   * part that matters: `transferredFromPolicyId` / `transferredToPolicyId` are
   * written as a pair inside one transaction and cannot legitimately loop, but a
   * bad migration or a hand-edit could make them, and an infinite loop in a
   * request handler is a worse outcome than a truncated history.
   */
  async replacementChain(
    access: AccessContext,
    branchId: string | null,
    policyId: string,
  ): Promise<PolicyReplacementChain> {
    const { policy } = await this.policies.loadOwnedPolicy(
      access,
      branchId,
      policyId,
    );
    const agencyId = String(policy.agencyId);

    // Back to the root. `seen` guards a cycle; `MAX_CHAIN` guards a chain so
    // long it can only be corrupt.
    const MAX_CHAIN = 50;
    const seen = new Set<string>([String(policy._id)]);

    let root = policy;
    while (root.transferredFromPolicyId && seen.size < MAX_CHAIN) {
      const previous = await this.policyModel
        .findOne({ _id: root.transferredFromPolicyId, agencyId })
        .select(
          'policyNumber policyType carrier premium policyStatus active effectiveDate dealId transferredFromPolicyId transferredToPolicyId',
        );
      if (!previous || seen.has(String(previous._id))) break;
      seen.add(String(previous._id));
      root = previous;
    }

    // Forward to the end, collecting as we go.
    const chain: PolicyDocument[] = [root];
    const walked = new Set<string>([String(root._id)]);
    let cursor = root;
    while (cursor.transferredToPolicyId && walked.size < MAX_CHAIN) {
      const next = await this.policyModel
        .findOne({ _id: cursor.transferredToPolicyId, agencyId })
        .select(
          'policyNumber policyType carrier premium policyStatus active effectiveDate dealId transferredFromPolicyId transferredToPolicyId',
        );
      if (!next || walked.has(String(next._id))) break;
      walked.add(String(next._id));
      chain.push(next);
      cursor = next;
    }

    /*
     * One query for every chargeback on the chain rather than one per policy.
     * A chain of three is three round trips otherwise, for a panel that renders
     * on a page load.
     */
    const chargebacks = await this.chargebackModel
      .find({ agencyId, policyId: { $in: chain.map((p) => p._id) } })
      .select('policyId amount withinClawbackWindow')
      .lean<
        {
          policyId: Types.ObjectId;
          amount: number;
          withinClawbackWindow: boolean;
        }[]
      >();
    const chargebackByPolicy = new Map(
      chargebacks.map((row) => [String(row.policyId), row]),
    );

    const requestedId = String(policy._id);
    const entries = chain.map((entry, index) => {
      const chargeback = chargebackByPolicy.get(String(entry._id)) ?? null;
      /*
       * How this policy was left, derived from its status rather than stored a
       * second time. Only a policy with a successor was left at all — the last
       * one is still in force, so its reason is null even if its status happens
       * to read `Cancelled` for an unrelated reason.
       */
      const hasSuccessor = index < chain.length - 1;
      const reason: PolicyReplacementReason | null = !hasSuccessor
        ? null
        : normalizePolicyStatus(entry.policyStatus) ===
            RETIRED_POLICY_STATUS.cancel_rewrite
          ? 'cancel_rewrite'
          : 'company_transfer';

      return {
        policyId: String(entry._id),
        policyNumber: entry.policyNumber ?? null,
        policyType: entry.policyType ?? null,
        carrier: entry.carrier ?? null,
        premium: entry.premium ?? 0,
        status: normalizePolicyStatus(entry.policyStatus),
        active: Boolean(entry.active),
        effectiveDate: entry.effectiveDate?.toISOString() ?? null,
        reason,
        chargebackAmount: chargeback?.amount ?? null,
        withinClawbackWindow: chargeback?.withinClawbackWindow ?? null,
        dealId: entry.dealId ? String(entry.dealId) : null,
        isRequested: String(entry._id) === requestedId,
      } satisfies PolicyReplacementChainEntry;
    });

    return {
      entries,
      totalChargeback: roundCents(
        entries.reduce((sum, entry) => sum + (entry.chargebackAmount ?? 0), 0),
      ),
    };
  }

  /**
   * The ledger row, plus the deal adjustment it accounts for.
   *
   * Both writes are in the caller's transaction and must stay that way: the row
   * is the explanation of the `$inc`, and one without the other is either an
   * unexplained reduction in a producer's figures or a chargeback nobody was
   * actually charged.
   */
  private async writeChargeback(args: {
    deps: Parameters<
      NonNullable<Parameters<SoldDealIntakeService['process']>[4]>
    >[0];
    cancelled: PolicyDocument;
    replacementPolicyId: Types.ObjectId | null;
    originalDeal: DealDocument | null;
    outcome: ReturnType<typeof rewriteFinancialOutcome>;
    cancelledAt: Date;
    producerId: Types.ObjectId | null;
    producerName: string;
  }): Promise<void> {
    const {
      deps,
      cancelled,
      replacementPolicyId,
      originalDeal,
      outcome,
      cancelledAt,
      producerId,
      producerName,
    } = args;

    await this.chargebackModel.create(
      [
        {
          agencyId: String(cancelled.agencyId),
          branchId: String(cancelled.branchId ?? ''),
          policyId: cancelled._id,
          policyNumber: cancelled.policyNumber,
          policyType: cancelled.policyType,
          dealId: originalDeal?._id ?? null,
          replacementPolicyId,
          householdId: cancelled.householdId ?? null,
          producerId,
          producerName,
          reason: 'cancel_rewrite',
          source: 'app',
          amount: outcome.chargebackAmount,
          soldAdjustment: outcome.soldAdjustment,
          withinClawbackWindow: outcome.withinClawbackWindow,
          occurredAt: cancelledAt,
          soldDate: originalDeal?.soldDate ?? null,
          // `bulkWrite` is not the only thing that bypasses the authorship
          // plugin — `create` inside a session does fire it, but the value is
          // spread explicitly here so the row records its author even when the
          // rewrite is driven by a job with no request context.
          ...authorshipForInsert(),
        },
      ],
      sessionOptions(deps.session),
    );

    /*
     * Only inside the window is there anything to take back. `$inc` rather than
     * `$set`: a deal can have more than one of its policies rewritten, and each
     * clawback adds to the last. Outside the window this is a no-op by
     * construction — `soldAdjustment` is 0 — and the guard just avoids a write.
     */
    if (originalDeal && outcome.soldAdjustment !== 0) {
      await this.dealModel.updateOne(
        { _id: originalDeal._id, agencyId: String(cancelled.agencyId) },
        { $inc: { chargebackAdjustment: outcome.soldAdjustment } },
        sessionOptions(deps.session),
      );
    }
  }

  /**
   * The cancellation date, clamped to something defensible.
   *
   * The client sends it so a cancellation processed on Monday for a policy the
   * carrier killed on Friday is recorded on Friday. Two clamps, because this
   * date decides whether a producer loses their credit:
   *
   *   - **Never in the future.** A date next month would put an out-of-window
   *     cancellation inside it — or rather outside it — by typo.
   *   - **Never before the sale.** A date before `soldDate` is nonsense, and
   *     `isWithinClawbackWindow` already answers `false` for it; clamping makes
   *     the *stored* record sane too rather than leaving an impossible date in
   *     the ledger.
   */
  private resolveCancelledAt(
    raw: string,
    originalDeal: DealDocument | null,
  ): Date {
    const parsed = new Date(`${raw}T00:00:00.000Z`);
    const now = new Date();
    let resolved = Number.isNaN(parsed.getTime()) ? now : parsed;

    if (resolved > now) resolved = now;

    const soldDate = originalDeal?.soldDate;
    if (soldDate && resolved < soldDate) resolved = soldDate;

    return resolved;
  }

  /** A user's display name, or '' — never a throw on a deactivated account. */
  private async actorName(userId: string): Promise<string> {
    if (!Types.ObjectId.isValid(userId)) return '';
    const user = await this.userModel
      .findById(userId)
      .select('firstName lastName')
      .lean<{ firstName?: string; lastName?: string }>();
    if (!user) return '';
    return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  }
}

/** Money to two decimals — a chain total is a float sum of premiums. */
function roundCents(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}
