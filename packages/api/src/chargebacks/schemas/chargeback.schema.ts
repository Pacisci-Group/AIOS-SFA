import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { CHARGEBACK_REASONS, CHARGEBACK_SOURCES } from '@sfa/shared';
import type { ChargebackReason, ChargebackSource } from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';
import { TenantRecord } from '../../common/schemas/tenant-record.schema';

export type ChargebackDocument = HydratedDocument<Chargeback>;

/** The reasons whose row may name no policy (see `policyId`). */
const POLICYLESS_REASONS: readonly ChargebackReason[] = [
  'carrier_statement',
  'manual',
];

/**
 * One chargeback event — commission the agency gives back because a policy did
 * not stay on the books.
 *
 * **An append-only ledger, not a running total.** Nothing here is ever edited:
 * the amount, the window verdict and the dates are all stamped at the moment of
 * cancellation, so a later correction to a deal's sold date cannot silently
 * rewrite what a producer was charged three months ago. Reversing a row means
 * writing the reversal, not deleting the row — with one exception: a
 * manager's manual line (PAC-182) is deleted with its statement adjustment,
 * and only while that statement is a draft or disputed (an issued version
 * that printed it keeps its file in the statement's history).
 *
 * Rows come from the app (cancel rewrite, cancellation), from the chargeback
 * report the owner imports on the Payouts page (PAC-180, `source:
 * 'carrier_statement'`) and from a manager's line on a statement (PAC-182,
 * `reason: 'manual'`, `source: 'app'`, `statementId`). See
 * `domain/chargeback.ts`.
 */
@Schema({ timestamps: true, collection: 'chargebacks' })
export class Chargeback extends TenantRecord {
  /**
   * The policy that went away. The amount is its premium.
   *
   * Indexed because the policy page asks "what did this cost?" — one lookup by
   * policy is the only per-record read path.
   *
   * `null` only for a chargeback-report line whose policy number the app does
   * not hold (PAC-180) — the report still says who to charge and how much —
   * and, with PAC-182, a manager's manual line. The app's own rows (a cancel
   * rewrite, a cancellation) always name their policy, so it stays required
   * for them: a writer that forgot it fails here instead of saving a row the
   * policy page and the rewrite index can never find.
   */
  @Prop({
    type: ObjectIdType,
    ref: 'Policy',
    default: null,
    index: true,
    required: [
      function (this: { reason?: ChargebackReason }) {
        return !POLICYLESS_REASONS.includes(this.reason as ChargebackReason);
      },
      'An app chargeback must name its policy.',
    ],
  })
  policyId: Types.ObjectId | null;

  /** Denormalized so a ledger row renders without loading a dead policy. */
  @Prop({ trim: true })
  policyNumber?: string;

  /**
   * `policyNumberKey(policyNumber)` (`@sfa/shared`), on a row that names no
   * policy — `''` when the number has no letters or digits — so "is this
   * number already charged back?" reads that number's rows, not every
   * policy-less row the agency has (PAC-182 review). `null` on rows that
   * name their policy: those are found by `policyId`. Migration
   * `20261111120000-chargeback_number_keys` filled it in on older rows.
   */
  @Prop({ type: String, default: null })
  policyNumberKey: string | null;

  @Prop({ trim: true })
  policyType?: string;

  /**
   * The deal the producer was originally credited on — what `soldAdjustment`
   * was applied to. Null for a policy with no deal (migrated, household-only).
   */
  @Prop({ type: ObjectIdType, ref: 'Deal', default: null, index: true })
  dealId: Types.ObjectId | null;

  /** The policy written to replace it. Null if the rewrite wrote none. */
  @Prop({ type: ObjectIdType, ref: 'Policy', default: null })
  replacementPolicyId: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'Household', default: null, index: true })
  householdId: Types.ObjectId | null;

  /**
   * Who carries it: the producer credited on the **original** deal, not whoever
   * recorded the cancellation.
   *
   * That distinction is the whole point of storing it — a CSR processes the
   * rewrite, and charging them for it would be exactly wrong. `createdBy` (from
   * `authorshipPlugin`) records who did the recording.
   */
  @Prop({ type: ObjectIdType, ref: 'User', default: null, index: true })
  producerId: Types.ObjectId | null;

  /** Denormalized at write time; a producer can be deactivated later. */
  @Prop({ trim: true, default: '' })
  producerName: string;

  /*
   * `type: String` is **required** on both of these, not decoration.
   * `ChargebackReason` is a string-literal union, and `@nestjs/mongoose` cannot
   * infer a schema type from one — it throws `CannotDetermineTypeError` at
   * import time, which no typecheck catches because the types are perfectly
   * valid TypeScript. `Deal.businessType` is declared the same way for the same
   * reason.
   */
  @Prop({ type: String, required: true, enum: CHARGEBACK_REASONS })
  reason: ChargebackReason;

  @Prop({
    type: String,
    required: true,
    enum: CHARGEBACK_SOURCES,
    default: 'app',
  })
  source: ChargebackSource;

  /** Always positive — the amount clawed back, never a signed adjustment. */
  @Prop({ required: true, default: 0 })
  amount: number;

  /** `-amount` inside the one-month window, `0` outside it. */
  @Prop({ required: true, default: 0 })
  soldAdjustment: number;

  @Prop({ required: true, default: false })
  withinClawbackWindow: boolean;

  /**
   * The date the window was judged on: the replacement's sold date for a
   * rewrite; **the carrier's cancellation date** for a `cancellation`, which
   * the person enters (PAC-173 PR 6).
   *
   * Separate from `createdAt` deliberately: a backdated cancellation is a real
   * thing a service team needs, and the day the window was measured against
   * must stay legible when it arrives.
   */
  @Prop({ type: Date, required: true, index: true })
  occurredAt: Date;

  /** The sold date the window was measured from, frozen for an auditor. */
  @Prop({ type: Date, default: null })
  soldDate: Date | null;

  /**
   * The carrier as the chargeback report gives it (PAC-180): the policy's
   * when the app holds it, else the report's. Null on the app's own rows,
   * whose carrier is the policy's.
   */
  @Prop({ type: String, trim: true, default: null })
  carrier: string | null;

  /** The customer as the report names them (PAC-180); null on app rows. */
  @Prop({ type: String, trim: true, default: null })
  customerName: string | null;

  /**
   * The pay month the row counts in, `YYYY-MM` — set on report rows (the month
   * the owner imported it for) and manual ones. Null on the app's rows, which
   * count in the month of `occurredAt`. A statement reads
   * `statementMonth = month OR (statementMonth = null AND occurredAt in month)`.
   */
  @Prop({ type: String, default: null })
  statementMonth: string | null;

  /** The chargeback-report import that wrote it (PAC-180). */
  @Prop({ type: ObjectIdType, ref: 'ChargebackImport', default: null })
  importId: Types.ObjectId | null;

  /** The statement a manager's manual line belongs to (PAC-182). */
  @Prop({ type: ObjectIdType, ref: 'PayStatement', default: null })
  statementId: Types.ObjectId | null;
}

export const ChargebackSchema = SchemaFactory.createForClass(Chargeback);

/**
 * The producer scorecard's read: one producer's chargebacks over a period.
 *
 * `agencyId` leads because every query is tenant-scoped and a cross-tenant scan
 * is the failure that matters; `occurredAt` descending is both the period filter
 * and the order the ledger is shown in.
 */
ChargebackSchema.index({ agencyId: 1, producerId: 1, occurredAt: -1 });

/**
 * A statement's read of the rows that count by pay month (report and manual
 * lines), beside the `occurredAt` index above for the app's own.
 */
ChargebackSchema.index({ agencyId: 1, statementMonth: 1, producerId: 1 });

/**
 * "A policy is charged back once" for a number the app holds no policy for
 * (`existingChargebacks`): the policy-less rows of a few numbers.
 */
ChargebackSchema.index({ agencyId: 1, policyId: 1, policyNumberKey: 1 });

/**
 * One chargeback per policy per rewrite.
 *
 * The rewrite runs in a transaction and its submission token already guards the
 * replay path, but this is the constraint that survives a token that was never
 * sent — a double-submitted rewrite would otherwise charge a producer twice for
 * the same cancellation, which is the one error nobody notices until payroll.
 *
 * Partial rather than plain-unique: `reason` has gained values, and a
 * chargeback-report row for the same policy is a different fact, not a
 * duplicate (the import flags that overlap for the owner instead).
 *
 * `cancellation` (PAC-173 PR 6) is deliberately outside it. One cancellation
 * cannot write two rows — `PoliciesService.applyCancellation` writes the row
 * and the cancelled policy in one transaction, so a second cancel conflicts on
 * the policy and then reads it cancelled — but a policy reinstated and
 * cancelled again is a second event, with a row of its own.
 */
ChargebackSchema.index(
  { agencyId: 1, policyId: 1, reason: 1 },
  {
    unique: true,
    partialFilterExpression: { reason: 'cancel_rewrite' },
  },
);
