import type { ClientSession, Model, Types } from 'mongoose';
import type { Chargeback } from '../../chargebacks/schemas/chargeback.schema';

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
 * A manager's manual line (`reason: 'manual'`, `statementId`) gets its writer
 * with its only caller, the statement adjustments of PAC-182.
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
