import { policyNumberKey } from '@sfa/shared';
import { Types, type ClientSession, type Model } from 'mongoose';
import type { Agency } from '../../platform/schemas/agency.schema';
import type { Chargeback } from '../../chargebacks/schemas/chargeback.schema';
import type { PolicyByNumber } from './match-import-rows';

/**
 * Writes chargeback-report lines to the ledger (PAC-180) — the sibling of
 * `policies/chargeback-ledger.ts` `writeChargeback`, which writes the app's
 * own rows.
 *
 * What differs, and why:
 *
 * - `source` and `reason` are `carrier_statement`, and the row counts in the
 *   import's month (`statementMonth`), not the month of its date.
 * - The amount is the report's, as given (premium dollars, positive).
 * - **No `Deal.chargebackAdjustment` `$inc`**, `soldAdjustment: 0`,
 *   `withinClawbackWindow: false`: the sold figure dashboards show is the
 *   app's own one-month rule's business, and Payouts never applies
 *   `chargebackAdjustment` anyway (the ledger row carries the money).
 * - `policyId` may be null: a line whose policy the app does not hold is
 *   still a chargeback the report approved.
 *
 * And a manager's manual line on a statement (PAC-182, {@link
 * writeManualChargeback}): `reason: 'manual'`, `source: 'app'`, tied to its
 * statement (`statementId`) and counted in the statement's month.
 */

export interface ImportedChargebackLine {
  /** Made by the caller, so the import row can name it in the same write. */
  chargebackId: Types.ObjectId;
  producerId: Types.ObjectId;
  producerName: string;
  branchId: string;
  policyId: Types.ObjectId | null;
  policyNumber: string;
  policyType: string | null;
  dealId: Types.ObjectId | null;
  householdId: Types.ObjectId | null;
  carrier: string;
  customerName: string | null;
  amount: number;
  /** The report's date, else the first instant of the month. */
  occurredAt: Date;
  soldDate: Date | null;
}

export interface ImportedChargebackContext {
  agencyId: string;
  importId: Types.ObjectId;
  /** `YYYY-MM`. */
  month: string;
}

/** The ledger document for one report line. Pure. */
export function importedChargebackDoc(
  line: ImportedChargebackLine,
  context: ImportedChargebackContext,
): Record<string, unknown> {
  return {
    _id: line.chargebackId,
    agencyId: context.agencyId,
    branchId: line.branchId,
    policyId: line.policyId,
    policyNumber: line.policyNumber,
    policyNumberKey: numberKeyFor(line.policyId, line.policyNumber),
    policyType: line.policyType ?? undefined,
    dealId: line.dealId,
    replacementPolicyId: null,
    householdId: line.householdId,
    producerId: line.producerId,
    producerName: line.producerName,
    reason: 'carrier_statement',
    source: 'carrier_statement',
    amount: line.amount,
    soldAdjustment: 0,
    withinClawbackWindow: false,
    occurredAt: line.occurredAt,
    soldDate: line.soldDate,
    carrier: line.carrier,
    customerName: line.customerName,
    statementMonth: context.month,
    importId: context.importId,
    statementId: null,
  };
}

/**
 * `Chargeback.policyNumberKey`: the number's key on a row that names no
 * policy (what `existingChargebacks` reads it by), `null` on one that does.
 */
function numberKeyFor(
  policyId: Types.ObjectId | null,
  policyNumber: string,
): string | null {
  return policyId ? null : policyNumberKey(policyNumber);
}

/**
 * One insert for every line, inside the caller's transaction. `authorshipPlugin`
 * stamps `createdBy` on `insertMany` from the request.
 */
export async function writeImportedChargebacks(
  model: Model<Chargeback>,
  lines: readonly ImportedChargebackLine[],
  context: ImportedChargebackContext,
  session: ClientSession | null,
): Promise<void> {
  if (!lines.length) return;
  await model.insertMany(
    lines.map((line) => importedChargebackDoc(line, context)),
    session ? { session, ordered: true } : { ordered: true },
  );
}

/**
 * The ledger lock: the first write of every transaction that charges a
 * policy from Payouts — a report commit (PAC-180) or a manual line (PAC-182).
 * Two of them in one agency write-conflict here, and the second retries
 * after the first has committed, then finds the policy the first charged.
 * The no-replica-set fallback has no transaction, so no such guarantee (see
 * `TransactionRunner`).
 */
export async function lockChargebackLedger(
  agencyModel: Model<Agency>,
  agencyId: string,
  session: ClientSession | null,
): Promise<void> {
  await agencyModel.updateOne(
    { _id: new Types.ObjectId(agencyId) },
    { $inc: { chargebackImportsRevision: 1 } },
    { ...(session ? { session } : {}), timestamps: false },
  );
}

/** A manager's chargeback on a statement (PAC-182). */
export interface ManualChargebackLine {
  /** Made by the caller, so the adjustment can name it in the same write. */
  chargebackId: Types.ObjectId;
  statementId: Types.ObjectId;
  /** The statement's month, `YYYY-MM`: the row counts in it. */
  month: string;
  producerId: Types.ObjectId;
  producerName: string;
  branchId: string;
  /** The policy the app holds with this number, if any. */
  policy: PolicyByNumber | null;
  policyNumber: string;
  /**
   * The carrier the reviewer chose — for a policy the app does not hold, or
   * holds without a carrier. `null` when the held policy has its own, which
   * is then read through it.
   */
  carrier: string | null;
  customerName: string | null;
  amount: number;
  /** The month's first instant on the statement's clock. */
  occurredAt: Date;
}

/**
 * The ledger document for a manual line. Pure. Like a report line it has no
 * `Deal.chargebackAdjustment` side and a zero `soldAdjustment`; unlike one
 * it is the app's (`source: 'app'`). A held policy lends its id, type,
 * household and sale. Its carrier is read through it, as for the app's own
 * rows — unless it has none: then the row keeps the carrier the reviewer
 * chose, or the chargeback would come off the no-carrier rate.
 */
export function manualChargebackDoc(
  line: ManualChargebackLine,
  agencyId: string,
): Record<string, unknown> {
  const policy = line.policy;
  const policyNumber = policy?.policyNumber || line.policyNumber;
  return {
    _id: line.chargebackId,
    agencyId,
    branchId: line.branchId,
    policyId: policy?.policyId ?? null,
    policyNumber,
    policyNumberKey: numberKeyFor(policy?.policyId ?? null, policyNumber),
    policyType: policy?.policyType ?? undefined,
    dealId: policy?.dealId ?? null,
    replacementPolicyId: null,
    householdId: policy?.householdId ?? null,
    producerId: line.producerId,
    producerName: line.producerName,
    reason: 'manual',
    source: 'app',
    amount: line.amount,
    soldAdjustment: 0,
    withinClawbackWindow: false,
    occurredAt: line.occurredAt,
    soldDate: policy?.soldDate ?? null,
    carrier: line.carrier,
    customerName: line.customerName ?? policy?.clientName ?? null,
    statementMonth: line.month,
    importId: null,
    statementId: line.statementId,
  };
}

/** Insert one manual line, inside the caller's transaction. */
export async function writeManualChargeback(
  model: Model<Chargeback>,
  line: ManualChargebackLine,
  agencyId: string,
  session: ClientSession | null,
): Promise<void> {
  await model.insertMany(
    [manualChargebackDoc(line, agencyId)],
    session ? { session, ordered: true } : { ordered: true },
  );
}
