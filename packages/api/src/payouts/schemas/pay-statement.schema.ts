import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  PAY_STATEMENT_STATUSES,
  PAYOUT_POOLS,
  STATEMENT_ADJUSTMENT_KINDS,
  STATEMENT_HISTORY_OUTCOMES,
  type PayoutPool,
  type PayStatementStatus,
  type PremiumLineView,
  type StatementAdjustmentKind,
  type StatementBonusesView,
  type StatementChargebackView,
  type StatementDealView,
  type StatementHistoryOutcome,
  type StatementIndicatorsView,
  type StatementInputs,
  type StatementInputsNeeded,
  type StatementStructureSnapshot,
  type StatementTotalsView,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type PayStatementDocument = HydratedDocument<PayStatement>;

/**
 * A manager's correction (PAC-182 writes them; PAC-178's math applies them).
 * Kept across recalculations: a recalculation recomputes what the data
 * says, and the adjustments are the manager's word on top of it.
 */
@Schema({ _id: true, timestamps: false })
export class PayStatementAdjustment {
  _id: Types.ObjectId;

  @Prop({ type: String, enum: STATEMENT_ADJUSTMENT_KINDS, required: true })
  kind: StatementAdjustmentKind;

  @Prop({ type: ObjectIdType, ref: 'Chargeback', default: null })
  chargebackId: Types.ObjectId | null;

  @Prop({ type: Number, default: null })
  amount: number | null;

  @Prop({ type: String, default: '' })
  note: string;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: Date, required: true })
  createdAt: Date;
}
const PayStatementAdjustmentSchema = SchemaFactory.createForClass(
  PayStatementAdjustment,
);

/**
 * An issued Commission Statement PDF (PAC-181), or the signed copy of one
 * (PAC-182), in object storage under `agencies/<agencyId>/pay-statements/
 * <year of upload>/<statementId>/<uuid>-commission-statement-<month>-v<n>.pdf`
 * (`…-v<n>-signed.pdf` for a signed copy). The UUID makes each upload's key
 * unique, so an attempt that loses a race deletes only its own file. Only the
 * key is kept — a link is minted per read and never stored.
 */
@Schema({ _id: false, timestamps: false })
export class PayStatementPdf {
  @Prop({ type: String, required: true })
  key: string;

  /** SHA-256 of the file, hex. */
  @Prop({ type: String, required: true })
  sha256: string;

  @Prop({ type: Number, required: true })
  size: number;

  @Prop({ type: Date, required: true })
  renderedAt: Date;

  /**
   * What the header band printed (PAC-182 review): the agency's branded name,
   * and the storage key of the logo embedded — `null` when it printed the
   * name alone. A signed copy is printed with these, so it matches the
   * issued file it signs whatever the branding is today. A replaced logo
   * keeps its file: every upload has a key of its own. Missing on files
   * issued before it was stored.
   */
  @Prop({ type: String, default: null })
  agencyName?: string | null;

  @Prop({ type: String, default: null })
  logoKey?: string | null;
}
const PayStatementPdfSchema = SchemaFactory.createForClass(PayStatementPdf);

/**
 * The employee's dispute of the current version (PAC-182). It moves onto the
 * `superseded` history row when the statement is sent again, and the next
 * version prints its notes in the PDF's Comments / Dispute notes box.
 */
@Schema({ _id: false, timestamps: false })
export class PayStatementRejection {
  @Prop({ type: Date, required: true })
  rejectedAt: Date;

  /** `\n` line breaks, trimmed (`normalizeStatementText`). */
  @Prop({ type: String, required: true })
  notes: string;
}
const PayStatementRejectionSchema = SchemaFactory.createForClass(
  PayStatementRejection,
);

/**
 * The employee's acceptance (PAC-182): the name they typed as a signature,
 * and the account and browser they accepted from — what the signed copy's
 * audit line prints. No IP address (owner, 10 Nov 2026: behind the load
 * balancer the API sees only the balancer's, and the forwarded one is the
 * client's to say).
 */
@Schema({ _id: false, timestamps: false })
export class PayStatementAcceptance {
  @Prop({ type: Date, required: true })
  acceptedAt: Date;

  @Prop({ type: String, required: true })
  typedName: string;

  /** The signed-in account's email when they accepted. */
  @Prop({ type: String, required: true })
  accountEmail: string;

  @Prop({ type: String, default: '' })
  userAgent: string;
}
const PayStatementAcceptanceSchema = SchemaFactory.createForClass(
  PayStatementAcceptance,
);

/**
 * An issued version that is no longer current (PAC-181): its file and who
 * sent it, kept when the statement is reopened or a disputed one is sent
 * again — with the dispute that led to it, for a `superseded` one (PAC-182).
 * `version === history.length + 1` always — see `STATEMENT_HISTORY_OUTCOMES`.
 */
@Schema({ _id: false, timestamps: false })
export class PayStatementHistoryEntry {
  @Prop({ type: Number, required: true })
  version: number;

  @Prop({ type: String, enum: STATEMENT_HISTORY_OUTCOMES, required: true })
  outcome: StatementHistoryOutcome;

  @Prop({ type: PayStatementPdfSchema, default: null })
  pdf: PayStatementPdf | null;

  @Prop({ type: Date, default: null })
  sentAt: Date | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  sentBy: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  sentByName: string | null;

  /** When it stopped being current. */
  @Prop({ type: Date, required: true })
  at: Date;

  /** The dispute a `superseded` version was sent again over (PAC-182). */
  @Prop({ type: PayStatementRejectionSchema, default: null })
  rejection?: PayStatementRejection | null;
}
const PayStatementHistoryEntrySchema = SchemaFactory.createForClass(
  PayStatementHistoryEntry,
);

/**
 * One person's commission statement for one month (PAC-178).
 *
 * **A snapshot, not a view.** Everything the statement says — the structure
 * it was computed with, each line, deal and chargeback, the bonuses, the
 * totals — is stored on it, because a sent statement is a document someone
 * signs: changing the structure, a sale or a chargeback afterwards must not
 * change what they were shown. A recalculation rewrites only `draft` and
 * `rejected` statements.
 *
 * The amounts are computed (`@sfa/shared` `payout-math.ts`), already rounded
 * to the cent, and may be negative, so they are plain numbers — the payout
 * input props (`MONEY_PROP`, which refuses below 0) are for what the owner
 * types.
 *
 * `branchId` is the person's branch when it was computed, as a string like
 * `TenantRecord`'s, so `buildScopeFilter` scopes a branch manager to it.
 *
 * **Sending (PAC-181)** renders the Commission Statement PDF, stores it
 * (`pdf`) and marks the statement `sent` with who sent it; reopening takes it
 * back to `draft` and moves the issued version into `history`. The PDF,
 * sender and history fields are absent on statements written before them —
 * read them as `null` / `[]`.
 *
 * **Sign-off (PAC-182)**: the employee accepts a sent statement (`accepted`,
 * final: `acceptance` and a `signedPdf` beside the issued `pdf`) or disputes
 * it (`rejected`: `rejection`, then a reviewer corrects it and sends it again
 * as the next version). Neither touches `version` or `history`. Absent on
 * older statements — read as `null`.
 */
@Schema({ timestamps: true, collection: 'payStatements' })
export class PayStatement {
  @Prop({ type: String, required: true })
  agencyId: string;

  @Prop({ type: String, default: null })
  branchId: string | null;

  @Prop({ type: String, default: null })
  branchName: string | null;

  @Prop({ type: ObjectIdType, ref: 'PayoutRun', required: true })
  runId: Types.ObjectId;

  /** `YYYY-MM`. */
  @Prop({ type: String, required: true })
  month: string;

  @Prop({ type: ObjectIdType, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true })
  userName: string;

  @Prop({ type: String, default: null })
  allstateBindId: string | null;

  @Prop({ type: [String], default: [] })
  roleNames: string[];

  @Prop({ type: [String], default: [] })
  roleSlugs: string[];

  @Prop({ type: String, enum: PAYOUT_POOLS, required: true })
  pool: PayoutPool;

  @Prop({ type: ObjectIdType, ref: 'PaymentStructure', required: true })
  structureId: Types.ObjectId;

  @Prop({ type: Object, required: true })
  structureSnapshot: StatementStructureSnapshot;

  @Prop({
    type: String,
    enum: PAY_STATEMENT_STATUSES,
    required: true,
    default: 'draft',
  })
  status: PayStatementStatus;

  /**
   * The version the statement is, or will be issued as: bumped when an
   * issued version stops being current (a reopen, or a disputed statement
   * sent again), so `version === history.length + 1`.
   */
  @Prop({ type: Number, required: true, default: 1 })
  version: number;

  @Prop({ type: String, required: true })
  timeZone: string;

  @Prop({ type: [Object], default: [] })
  premiumLines: PremiumLineView[];

  @Prop({ type: [Object], default: [] })
  deals: StatementDealView[];

  @Prop({ type: [Object], default: [] })
  chargebacks: StatementChargebackView[];

  @Prop({ type: Object, required: true })
  bonuses: StatementBonusesView;

  @Prop({ type: Object, required: true })
  indicators: StatementIndicatorsView;

  @Prop({ type: [PayStatementAdjustmentSchema], default: [] })
  adjustments: PayStatementAdjustment[];

  /**
   * The figures the manager enters (2026 comp plans): compliance rate,
   * retention, life referrals, meeting attendance. Like adjustments they are
   * the manager's word, so a recalculation keeps them. Absent on statements
   * drafted before they existed — read as all `null`.
   */
  @Prop({ type: Object, default: null })
  inputs: StatementInputs | null;

  /**
   * Which figures the page asks for: what the structure reads, plus the
   * compliance rate while Producer of the Year is on (it counts compliant
   * months all year). Written by every calculation.
   */
  @Prop({ type: Object, default: null })
  inputsNeeded: StatementInputsNeeded | null;

  @Prop({ type: Object, required: true })
  totals: StatementTotalsView;

  @Prop({ type: [String], default: [] })
  warnings: string[];

  @Prop({ type: Date, required: true })
  computedAt: Date;

  /** The issued PDF of the current version; `null` until it is sent. */
  @Prop({ type: PayStatementPdfSchema, default: null })
  pdf: PayStatementPdf | null;

  @Prop({ type: Date, default: null })
  sentAt: Date | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  sentBy: Types.ObjectId | null;

  /** The sender's name as it was when they sent it. */
  @Prop({ type: String, default: null })
  sentByName: string | null;

  @Prop({ type: [PayStatementHistoryEntrySchema], default: [] })
  history: PayStatementHistoryEntry[];

  /** The current version's dispute, while it is disputed (PAC-182). */
  @Prop({ type: PayStatementRejectionSchema, default: null })
  rejection?: PayStatementRejection | null;

  /** How the employee accepted it (PAC-182); set with `accepted`. */
  @Prop({ type: PayStatementAcceptanceSchema, default: null })
  acceptance?: PayStatementAcceptance | null;

  /**
   * The signed copy (PAC-182): the issued statement re-rendered with the
   * acknowledgment filled. The issued `pdf` is kept.
   */
  @Prop({ type: PayStatementPdfSchema, default: null })
  signedPdf?: PayStatementPdf | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PayStatementSchema = SchemaFactory.createForClass(PayStatement);

/** One statement per person per run — what a recalculation upserts on. */
PayStatementSchema.index(
  { agencyId: 1, runId: 1, userId: 1 },
  { unique: true },
);

/** My Pay: a person's statements, newest month first. */
PayStatementSchema.index({ agencyId: 1, userId: 1, month: -1 });

/** The Payouts table: a month's statements by status. */
PayStatementSchema.index({ agencyId: 1, month: 1, status: 1 });

/** A branch manager's month. */
PayStatementSchema.index({ agencyId: 1, branchId: 1, month: 1 });
