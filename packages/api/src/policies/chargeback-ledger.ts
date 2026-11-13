import type { ChargebackReason, RewriteFinancialOutcome } from '@sfa/shared';
import { Types, type ClientSession, type Model } from 'mongoose';
import type { ChargebackDocument } from '../chargebacks/schemas/chargeback.schema';
import { authorshipForInsert } from '../common/context/request-context';
import type { DealDocument } from '../deals/schemas/deal.schema';
import { sessionOptions } from '../sold-deals/intake/sold-intake.types';
import type { UserDocument } from '../users/schemas/user.schema';
import type { PolicyDocument } from './schemas/policy.schema';

/**
 * The one writer of the chargeback ledger, shared by the two flows that
 * charge money back (`domain/chargeback.ts`):
 *
 * - **Cancel Rewrite** (`PolicyRewritesService.recordForLead`, PAC-126), in the
 *   replacement sale's transaction;
 * - **a cancellation with a chargeback** (`PoliciesService.applyCancellation`,
 *   PAC-173 PR 6), in the cancel's transaction — the household page's Cancel
 *   button with **Record a chargeback** ticked, and a Dash row's Chargeback
 *   outcome.
 *
 * A function over models rather than a service method, so neither flow has to
 * reach into the other's service for it.
 */
export interface ChargebackLedgerModels {
  chargebackModel: Model<ChargebackDocument>;
  dealModel: Model<DealDocument>;
}

/**
 * The ledger row, plus the deal adjustment it accounts for.
 *
 * Both writes are in the caller's transaction and must stay that way: the row
 * is the explanation of the `$inc`, and one without the other is either an
 * unexplained reduction in a producer's figures or a chargeback nobody was
 * actually charged.
 */
export async function writeChargeback(
  models: ChargebackLedgerModels,
  args: {
    session: ClientSession | null;
    /** The policy that went away; the amount is its premium. */
    cancelled: PolicyDocument;
    /** The deal the producer was credited on — `null` for a policy with none. */
    originalDeal: Pick<DealDocument, '_id' | 'soldDate'> | null;
    reason: ChargebackReason;
    /** The replacement a rewrite wrote; `null` for a cancellation. */
    replacementPolicyId: Types.ObjectId | null;
    outcome: RewriteFinancialOutcome;
    /** The day the window was judged on. */
    occurredAt: Date;
    producerId: Types.ObjectId | null;
    producerName: string;
    /**
     * The branch the row takes when the policy has none (migrated ones can
     * lack it): `TenantRecord.branchId` is required.
     */
    fallbackBranchId: string;
  },
): Promise<ChargebackDocument> {
  const {
    session,
    cancelled,
    originalDeal,
    reason,
    replacementPolicyId,
    outcome,
    occurredAt,
    producerId,
    producerName,
    fallbackBranchId,
  } = args;
  const agencyId = String(cancelled.agencyId);

  const [row] = await models.chargebackModel.create(
    [
      {
        agencyId,
        branchId: cancelled.branchId || fallbackBranchId,
        policyId: cancelled._id,
        policyNumber: cancelled.policyNumber,
        policyType: cancelled.policyType,
        dealId: originalDeal?._id ?? null,
        replacementPolicyId,
        householdId: cancelled.householdId ?? null,
        producerId,
        producerName,
        reason,
        source: 'app',
        amount: outcome.chargebackAmount,
        soldAdjustment: outcome.soldAdjustment,
        withinClawbackWindow: outcome.withinClawbackWindow,
        occurredAt,
        soldDate: originalDeal?.soldDate ?? null,
        // `create` inside a session does fire the authorship plugin, but the
        // value is spread explicitly so the row records its author even when
        // the write is driven by a job with no request context.
        ...authorshipForInsert(),
      },
    ],
    sessionOptions(session),
  );

  /*
   * Only inside the window is there anything to take back. `$inc` rather than
   * `$set`: a deal can have more than one of its policies charged back, and
   * each clawback adds to the last. Outside the window this is a no-op by
   * construction — `soldAdjustment` is 0 — and the guard just avoids a write.
   */
  if (originalDeal && outcome.soldAdjustment !== 0) {
    await models.dealModel.updateOne(
      { _id: originalDeal._id, agencyId },
      { $inc: { chargebackAdjustment: outcome.soldAdjustment } },
      sessionOptions(session),
    );
  }
  return row;
}

/**
 * Take back **every** live cancellation chargeback on a policy, before a new
 * cancellation writes its own — the guard in
 * `PoliciesService.applyCancellation`, which holds the policy document in the
 * same transaction, so nothing can be charged to it between this and the new
 * row.
 *
 * A reinstatement must **not** use this: it takes back one row, the one its
 * cancellation raised — see {@link voidCancellationChargeback}.
 */
export async function voidCancellationChargebacks(
  models: ChargebackLedgerModels,
  args: {
    session: ClientSession | null;
    agencyId: string;
    policyId: Types.ObjectId;
    by: Types.ObjectId | null;
  },
): Promise<number> {
  return voidLive(models, args);
}

/**
 * Take back the **one** cancellation chargeback a reinstated cancellation
 * raised (`Policy.cancellation.chargebackId`) — the policy is back on the
 * books, so the cancellation it charged for no longer stands.
 *
 * By id, never "every live row on the policy" (PAC-173 review): a row the
 * policy holds *now* may belong to a later cancellation the reinstating
 * request never saw. Without transactions (`TransactionRunner`'s fallback), a
 * cancel-with-chargeback can land between the reinstatement's save and this
 * void; selecting by policy would then void the new row and leave the policy
 * cancelled with nothing charged back.
 */
export async function voidCancellationChargeback(
  models: ChargebackLedgerModels,
  args: {
    session: ClientSession | null;
    agencyId: string;
    policyId: Types.ObjectId;
    chargebackId: Types.ObjectId;
    by: Types.ObjectId | null;
  },
): Promise<number> {
  return voidLive(models, args);
}

/**
 * The void itself (PAC-173 review). Each row is stamped `voidedAt`, never
 * deleted (the ledger keeps what was charged and undone), and the deal
 * adjustment it made is reversed with the opposite `$inc` in the same session.
 * Only `cancellation` rows: a rewrite chargeback is undone by its own flow.
 *
 * A compare-and-swap per row on `voidedAt: null`, so two callers racing — or
 * a transaction retry — reverse an adjustment once. Returns how many it
 * voided.
 */
async function voidLive(
  models: ChargebackLedgerModels,
  args: {
    session: ClientSession | null;
    agencyId: string;
    policyId: Types.ObjectId;
    /** Just this row; every live one on the policy when absent. */
    chargebackId?: Types.ObjectId;
    by: Types.ObjectId | null;
  },
): Promise<number> {
  const { session, agencyId, policyId, chargebackId, by } = args;
  const live = await models.chargebackModel
    .find({
      agencyId,
      policyId,
      reason: 'cancellation',
      voidedAt: null,
      ...(chargebackId ? { _id: chargebackId } : {}),
    })
    .select('_id dealId soldAdjustment')
    .session(session)
    .lean<
      {
        _id: Types.ObjectId;
        dealId: Types.ObjectId | null;
        soldAdjustment: number;
      }[]
    >();
  let voided = 0;
  for (const row of live) {
    const done = await models.chargebackModel.updateOne(
      { _id: row._id, agencyId, voidedAt: null },
      { $set: { voidedAt: new Date(), voidedBy: by } },
      sessionOptions(session),
    );
    if (!done.modifiedCount) continue;
    voided += 1;
    if (row.dealId && row.soldAdjustment) {
      await models.dealModel.updateOne(
        { _id: row.dealId, agencyId },
        { $inc: { chargebackAdjustment: -row.soldAdjustment } },
        sessionOptions(session),
      );
    }
  }
  return voided;
}

/**
 * The producer a chargeback is charged to, by name — '' when there is none,
 * and never a throw on a deactivated account. Denormalised onto the row
 * because a producer can be deactivated later.
 */
export async function chargedProducerName(
  userModel: Model<UserDocument>,
  userId: Types.ObjectId | string | null | undefined,
): Promise<string> {
  if (!userId || !Types.ObjectId.isValid(String(userId))) return '';
  const user = await userModel
    .findById(userId)
    .select('firstName lastName')
    .lean<{ firstName?: string; lastName?: string }>();
  if (!user) return '';
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
}
