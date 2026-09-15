import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
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
  PolicyRewriteResult,
  SoldDocumentPresignResponse,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { AuditGenerationService } from '../audit-generation/audit-generation.service';
import {
  Chargeback,
  ChargebackDocument,
} from '../chargebacks/schemas/chargeback.schema';
import { authorshipForInsert } from '../common/context/request-context';
import { sessionOptions } from '../sold-deals/intake/sold-intake.types';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import {
  Household,
  HouseholdDocument,
} from '../households/schemas/household.schema';
import type { SoldIntakeDto } from '../sold-deals/dto/create-sold-deal.dto';
import { SoldDealIntakeService } from '../sold-deals/intake/sold-deal-intake.service';
import { SoldSubmissionValidator } from '../sold-deals/intake/sold-submission.validator';
import type { SoldIntakeContext } from '../sold-deals/intake/sold-intake.types';
import { rewriteDocumentPurpose } from '../sold-deals/dto/presign-sold-document.dto';
import type { PresignRewriteDocumentDto } from '../sold-deals/dto/presign-sold-document.dto';
import { StorageService } from '../storage/storage.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import type { CreatePolicyRewriteDto } from './dto/policy-rewrite.dto';
import { PoliciesService } from './policies.service';
import { Policy, PolicyDocument } from './schemas/policy.schema';

/**
 * Cancel Rewrite — a policy is cancelled and immediately replaced.
 *
 * Mechanically this is the Policy Transfer (PAC-63) with different money. Both
 * retire one policy, write another, and link the pair through
 * `transferredFromPolicyId` / `transferredToPolicyId`; both reuse the Sold
 * pipeline, because the information a policy needs to exist does not change
 * because of why it was written. Three things differ, and all three are the
 * point:
 *
 *   1. **Anchored on the policy, not a ticket.** A rewrite starts from the
 *      policy a service rep is looking at. There is no CSR ticket to clamp
 *      scope with, so `PoliciesService.loadOwnedPolicy` does that job instead.
 *   2. **The replacement is new business.** A transfer is booked
 *      `company_transfer` and kept off the producer scorecard; a rewrite is a
 *      real sale and counts. See `rewriteFinancialOutcome` for what the
 *      cancelled half does to the same scorecard.
 *   3. **It charges money back.** Always the cancelled policy's premium, and
 *      inside the first month it also reverses the credit on the original deal.
 *
 * ## The invariant
 *
 * **A policy cannot be `Cancel Rewrite` without a replacement.** That is the
 * product rule, and it is enforced structurally rather than by validation: the
 * only code that ever writes the status is `UpsertPoliciesStep.retireTransferred`,
 * which runs in the same transaction as the replacement it is being retired for,
 * and `PATCH /policies/:id` rejects the status outright. There is no request
 * shape anywhere that cancels without writing a replacement.
 *
 * ## Rewriting a rewrite
 *
 * Nothing special. The replacement is an ordinary active policy, so rewriting it
 * again retires it the same way and links it to a third — the chain is
 * `A → B → C`, walkable in both directions, and `PoliciesService.replacementChain`
 * is what renders the whole history rather than one hop.
 */
@Injectable()
export class PolicyRewritesService {
  private readonly logger = new Logger(PolicyRewritesService.name);

  constructor(
    @InjectModel(Policy.name)
    private readonly policyModel: Model<PolicyDocument>,
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    @InjectModel(Chargeback.name)
    private readonly chargebackModel: Model<ChargebackDocument>,
    @InjectModel(Household.name)
    private readonly householdModel: Model<HouseholdDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly policies: PoliciesService,
    private readonly intake: SoldDealIntakeService,
    private readonly submissions: SoldSubmissionValidator,
    private readonly auditGeneration: AuditGenerationService,
    private readonly storage: StorageService,
  ) {}

  /**
   * A presigned PUT for a document on an in-progress rewrite.
   *
   * Household-anchored, like the transfer's (`POST /sold-deals/documents` is the
   * lead-anchored sibling): a rewrite has no lead, and the key prefix *is* the
   * ownership check that {@link record} re-asserts through `verifyAttachments`.
   *
   * The household is read off the policy rather than named by the caller, and
   * the policy goes through `loadOwnedPolicy` first — so a presign cannot be
   * obtained for a household the caller could not otherwise reach.
   *
   * Without this the wizard had no endpoint to upload against and fell back to
   * the lead presign with an empty `leadId`, which fails validation — and since
   * the New Business Application is required and PDF-only, the rewrite could not
   * be submitted at all.
   */
  async presign(
    access: AccessContext,
    branchId: string | null,
    policyId: string,
    dto: PresignRewriteDocumentDto,
  ): Promise<SoldDocumentPresignResponse> {
    const { policy } = await this.policies.loadOwnedPolicy(
      access,
      branchId,
      policyId,
    );

    if (!policy.householdId) {
      throw new BadRequestException(
        'This policy is not linked to a household, so a replacement cannot be written for it. Link it first.',
      );
    }

    const key = this.storage.buildObjectKey({
      agencyId: String(policy.agencyId),
      purpose: rewriteDocumentPurpose(String(policy.householdId), dto.kind),
      filename: dto.filename,
    });
    const presigned = await this.storage.createPresignedUpload(
      key,
      dto.contentType,
    );
    return {
      key: presigned.key,
      uploadUrl: presigned.uploadUrl,
      requiredHeaders: presigned.requiredHeaders,
      expiresIn: presigned.expiresIn,
    };
  }

  /**
   * Cancel `policyId` and book its replacement.
   *
   * Returns the new deal and what the cancellation cost, so the caller can show
   * the producer the chargeback rather than leaving them to find it at month end.
   */
  async record(
    access: AccessContext,
    branchId: string | null,
    policyId: string,
    dto: CreatePolicyRewriteDto,
  ): Promise<PolicyRewriteResult> {
    const { policy: cancelled } = await this.policies.loadOwnedPolicy(
      access,
      branchId,
      policyId,
    );

    if (!cancelled.householdId) {
      // The replacement has to land somewhere, and the household is what every
      // downstream step keys off. A migrated policy with no household cannot be
      // rewritten until someone links it — which the unlinked-records view exists
      // to make possible.
      throw new BadRequestException(
        'This policy is not linked to a household, so a replacement cannot be written for it. Link it first.',
      );
    }

    if (!cancelled.active) {
      // Already retired — by an earlier rewrite, a transfer, or a plain
      // cancellation. Rewriting it again would write a second replacement for
      // coverage that already has one and charge the producer twice.
      throw new ConflictException(
        'This policy is not active, so it cannot be cancelled and rewritten.',
      );
    }

    if (cancelled.transferredToPolicyId) {
      throw new ConflictException(
        'This policy has already been replaced. Rewrite its replacement instead.',
      );
    }

    const agencyId = String(cancelled.agencyId);
    const householdId = cancelled.householdId;

    /*
     * The original deal is where the producer's credit lives, and therefore what
     * the clawback is measured against and applied to.
     *
     * Null for a migrated or household-only policy. That is not an error: the
     * chargeback is still recorded (the money came back either way), the window
     * evaluates false with no sold date, and there is simply no deal to reduce.
     */
    const originalDeal = cancelled.dealId
      ? await this.dealModel
          .findOne({ _id: cancelled.dealId, agencyId })
          .select('soldDate producerId premium chargebackAdjustment')
      : null;

    const cancelledAt = this.resolveCancelledAt(dto.cancelledAt, originalDeal);
    const outcome = rewriteFinancialOutcome(
      cancelled.premium,
      originalDeal?.soldDate ?? null,
      cancelledAt,
    );

    /*
     * `fromPolicyId` goes on the **first** row only.
     *
     * One policy is being cancelled, so exactly one replacement row may claim to
     * replace it — putting it on every row would retire the same policy N times
     * and, worse, leave `transferredToPolicyId` pointing at whichever row
     * happened to be written last. A rewrite that splits one policy into two
     * (an Auto becoming Auto + Motorcycle, say) is a real case, and the extra
     * rows are simply new policies on the same new deal.
     *
     * Prior insurance and cancellation are injected as "none", exactly as the
     * transfer does: the policy being replaced is already in our own book, so
     * there is no other carrier to name.
     */
    const intakeDto: SoldIntakeDto = {
      soldDate: dto.cancelledAt,
      submissionToken: dto.submissionToken,
      policies: dto.policies.map((row, index) => ({
        ...row,
        ...(index === 0 ? { fromPolicyId: String(cancelled._id) } : {}),
        priorInsurance: { none: true },
        cancellation: { cancelled: false },
      })),
    };

    await this.submissions.assertPolicyNumberFormats(intakeDto, agencyId);
    await this.submissions.verifyAttachments(intakeDto, agencyId, (kind) =>
      rewriteDocumentPurpose(String(householdId), kind),
    );

    /*
     * The producer credited on the original deal carries the chargeback — not
     * the person processing the rewrite. A CSR clicking the button must not be
     * charged for a sale they never made.
     *
     * The *replacement* is credited to the caller, matching the transfer path
     * and for the same reason: they did the work of writing it.
     */
    const chargedProducerId = originalDeal?.producerId ?? null;

    const ctx: SoldIntakeContext = {
      agencyId,
      branchId: String(cancelled.branchId ?? ''),
      producerId: new Types.ObjectId(access.userId),
      businessType: 'new_business',
      replacementReason: 'cancel_rewrite',
      householdId,
      submissionToken: dto.submissionToken
        ? `RWRT|${dto.submissionToken.toUpperCase()}`
        : null,
    };

    const producerName = chargedProducerId
      ? await this.actorName(String(chargedProducerId))
      : '';

    const result = await this.intake.process(
      ctx,
      intakeDto,
      access,
      undefined,
      // Inside the transaction: see the docblock on `process`. A replacement
      // written without its chargeback silently keeps credit that was clawed
      // back, and nothing downstream would ever detect it.
      async (deps, policies) => {
        await this.writeChargeback({
          deps,
          cancelled,
          replacementPolicyId: policies[0]?.policyId ?? null,
          originalDeal,
          outcome,
          cancelledAt,
          producerId: chargedProducerId,
          producerName,
        });
      },
    );

    /*
     * Post-commit and best-effort from here, exactly as on the sold and transfer
     * paths — the rewrite is booked either way, and failing the request now
     * would report that it did not happen when it did.
     */
    await this.auditGeneration.generateForDeal({
      agencyId,
      branchId: ctx.branchId,
      dealId: result.dealId,
      producerId: ctx.producerId,
      producerName: await this.actorName(access.userId),
      clientName: ctx.clientName,
      submissionToken: ctx.submissionToken,
      attachmentsByItem: undefined,
    });

    await this.recountHouseholdPolicies(householdId);

    return {
      dealId: String(result.dealId),
      cancelledPolicyId: String(cancelled._id),
      chargebackAmount: outcome.chargebackAmount,
      soldAdjustment: outcome.soldAdjustment,
      withinClawbackWindow: outcome.withinClawbackWindow,
      cancelledAt: cancelledAt.toISOString(),
      retiredStatus: RETIRED_POLICY_STATUS.cancel_rewrite,
    };
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

  /**
   * Bring `Household.totalActivePolicies` back in line with reality.
   *
   * The same recount the transfer runs, and for the same reason: a rewrite
   * deactivates one policy and activates another, so a stale count is visibly
   * wrong on the page the user is looking at. Recounted rather than incremented
   * so a re-run is still correct.
   */
  private async recountHouseholdPolicies(
    householdId: Types.ObjectId,
  ): Promise<void> {
    try {
      const active = await this.policyModel.countDocuments({
        householdId,
        active: true,
      });
      await this.householdModel.updateOne(
        { _id: householdId },
        { $set: { totalActivePolicies: active } },
      );
    } catch (error) {
      this.logger.warn(
        `Household policy recount failed for ${householdId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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
