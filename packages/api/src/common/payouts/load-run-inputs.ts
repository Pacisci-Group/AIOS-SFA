import {
  NEW_BUSINESS_MATCH,
  type ChargebackReason,
  type ChargebackSource,
  type PayoutChargeback,
  type PayoutSale,
} from '@sfa/shared';
import { Types, type Model } from 'mongoose';
import type { Carrier } from '../../carriers/schemas/carrier.schema';
import type { Chargeback } from '../../chargebacks/schemas/chargeback.schema';
import type { Contact } from '../../contacts/schemas/contact.schema';
import type { DealAudit } from '../../deal-audits/schemas/deal-audit.schema';
import type { Deal } from '../../deals/schemas/deal.schema';
import type { Household } from '../../households/schemas/household.schema';
import type { InstantWindow } from '../../performance/performance.range';
import type { Policy } from '../../policies/schemas/policy.schema';
import { businessDay } from '../dates/business-dates';
import { contactDisplayName } from '../domain/contact-names';
import {
  linesPrefix,
  sourceStages,
  SOLD_LINES,
} from '../sales-metrics/sales-pipelines';

/**
 * What a month's statements are computed from (PAC-178): each person's sales
 * and chargebacks, their failed deal audits, and the agency's whole sold
 * premium for the team threshold.
 *
 * ## The same sales as the Owner dashboard
 *
 * A sale is a deal that is new business (company transfers do not count),
 * not a test record, sold — `soldDate` — inside the month on the agency's
 * clock, credited to `Deal.producerId`. Its premium is its **policy lines**,
 * read through the dashboards' own `linesPrefix` (a deal with no policies
 * counts as one line of its own premium), so a statement's sold premium and
 * the Owner dashboard's for the same person and month are one number by
 * construction. Cancelled policies still count: the cancellation is a
 * chargeback, not a smaller sale. `Deal.chargebackAdjustment` is **not**
 * applied — the ledger row already carries that money, and applying both
 * would charge the person twice.
 *
 * The match is written out rather than taken from `soldMatch`, which needs a
 * request's `AccessContext`; a cron has none. It is the same clauses.
 *
 * ## Chargebacks
 *
 * Every ledger row charged to the person (`Chargeback.producerId`, the
 * producer credited on the original sale) that counts in the month: a row
 * with a `statementMonth` (a chargeback-report line, PAC-180, or a manager's
 * manual line) counts in that month, whatever its date; any other row (the
 * app's own) counts in the month of its `occurredAt`. The carrier is the
 * row's own when it carries one (report rows), else the policy's; the lead
 * source is the original deal's, resolved the way a sale's is, so a
 * chargeback lands on the line of the sale it reverses. The customer is the
 * app's name for the sale, else the report's.
 *
 * In `common/` so the worker can run it.
 */

export interface PayoutInputModels {
  deal: Model<Deal>;
  policy: Model<Policy>;
  chargeback: Model<Chargeback>;
  dealAudit: Model<DealAudit>;
  household: Model<Household>;
  contact: Model<Contact>;
}

export interface RunInputs {
  /** userId → the month's sales, oldest first. */
  sales: Map<string, PayoutSale[]>;
  /** userId → the month's chargebacks. */
  chargebacks: Map<string, PayoutChargeback[]>;
  /** userId → the month's sales whose deal audit failed. */
  failedAudits: Map<string, number>;
}

interface LeanSaleRow {
  _id: Types.ObjectId;
  producerId: Types.ObjectId;
  soldDate: Date;
  clientName?: string | null;
  householdId?: Types.ObjectId | null;
  policyTypes?: string[] | null;
  sourceId?: Types.ObjectId | null;
  lines: {
    carrier?: string | null;
    policyType?: string | null;
    premium: number;
    typed: boolean;
  }[];
}

interface LeanChargeback {
  _id: Types.ObjectId;
  policyId?: Types.ObjectId | null;
  policyNumber?: string | null;
  policyType?: string | null;
  dealId?: Types.ObjectId | null;
  householdId?: Types.ObjectId | null;
  producerId: Types.ObjectId;
  amount: number;
  occurredAt: Date;
  reason: ChargebackReason;
  source?: ChargebackSource | null;
  carrier?: string | null;
  customerName?: string | null;
}

/** The sold-deal match for a month — `NEW_BUSINESS_MATCH`, no test records. */
export function soldInMonth(
  agencyId: string,
  window: InstantWindow,
  producerIds?: readonly Types.ObjectId[],
): Record<string, unknown> {
  return {
    agencyId,
    isTestRecord: { $ne: true },
    ...NEW_BUSINESS_MATCH,
    ...(producerIds ? { producerId: { $in: [...producerIds] } } : {}),
    soldDate: { $gte: window.$gte, $lt: window.$lt },
  };
}

const idsOf = (values: (Types.ObjectId | null | undefined)[]) => [
  ...new Map(
    values
      .filter((value): value is Types.ObjectId => Boolean(value))
      .map((value) => [String(value), value]),
  ).values(),
];

/**
 * Households by id → a person's name to show: the primary contact's, else
 * the household's own name.
 */
async function householdNames(
  models: Pick<PayoutInputModels, 'household' | 'contact'>,
  agencyId: string,
  ids: Types.ObjectId[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!ids.length) return names;
  const households = await models.household
    .find({ agencyId, _id: { $in: ids } })
    .select({ name: 1, primaryContactId: 1 })
    .lean<
      {
        _id: Types.ObjectId;
        name?: string;
        primaryContactId?: Types.ObjectId;
      }[]
    >();
  const contactIds = idsOf(households.map((row) => row.primaryContactId));
  const contacts = contactIds.length
    ? await models.contact
        .find({ agencyId, _id: { $in: contactIds } })
        .select({ firstName: 1, lastName: 1 })
        .lean<
          { _id: Types.ObjectId; firstName?: string; lastName?: string }[]
        >()
    : [];
  const personName = new Map(
    contacts.map((row) => [String(row._id), contactDisplayName(row)]),
  );
  for (const row of households) {
    const name =
      (row.primaryContactId && personName.get(String(row.primaryContactId))) ||
      row.name?.trim() ||
      null;
    if (name) names.set(String(row._id), name);
  }
  return names;
}

/**
 * The ledger rows that count in a pay month: those stamped with it
 * (`statementMonth` — chargeback-report and manual lines), and the app's own,
 * which carry none, by `occurredAt` in the month's window. A report line dated
 * in another month still counts in the month it was imported for.
 */
export function chargebacksInMonth(
  month: string,
  window: InstantWindow,
): Record<string, unknown> {
  return {
    $or: [
      { statementMonth: month },
      {
        statementMonth: null,
        occurredAt: { $gte: window.$gte, $lt: window.$lt },
      },
    ],
  };
}

const UNNAMED_CLIENT = 'Unnamed client';

/** The month's sales, chargebacks and failed audits for `memberIds`. */
export async function loadRunInputs(
  models: PayoutInputModels,
  args: {
    agencyId: string;
    /** `YYYY-MM` — what report and manual chargebacks are counted by. */
    month: string;
    /** The month on the agency's clock — what sales and app chargebacks are. */
    window: InstantWindow;
    timeZone: string;
    memberIds: readonly string[];
  },
): Promise<RunInputs> {
  const { agencyId, month, window, timeZone } = args;
  const members = args.memberIds.map((id) => new Types.ObjectId(id));
  const inputs: RunInputs = {
    sales: new Map(),
    chargebacks: new Map(),
    failedAudits: new Map(),
  };
  if (!members.length) return inputs;

  // Sales, with their lines and lead source, in one pass.
  const rows = await models.deal.aggregate<LeanSaleRow>([
    ...linesPrefix(
      soldInMonth(agencyId, window, members),
      SOLD_LINES,
      {},
      true,
      { carrier: true },
    ),
    {
      $project: {
        producerId: 1,
        soldDate: 1,
        clientName: 1,
        householdId: 1,
        policyTypes: 1,
        sourceId: 1,
        lines: 1,
      },
    },
    { $sort: { soldDate: 1, _id: 1 } },
  ]);

  const chargebackRows = await models.chargeback
    .find({
      agencyId,
      producerId: { $in: members },
      ...chargebacksInMonth(month, window),
    })
    .select({
      policyId: 1,
      policyNumber: 1,
      policyType: 1,
      dealId: 1,
      householdId: 1,
      producerId: 1,
      amount: 1,
      occurredAt: 1,
      reason: 1,
      source: 1,
      carrier: 1,
      customerName: 1,
    })
    .sort({ occurredAt: 1, _id: 1 })
    .lean<LeanChargeback[]>();

  // What a chargeback needs from elsewhere: its policy's carrier, and its
  // original deal's lead source and client.
  const policyIds = idsOf(chargebackRows.map((row) => row.policyId));
  const policies = policyIds.length
    ? await models.policy
        .find({ agencyId, _id: { $in: policyIds } })
        .select({ carrier: 1, policyNumber: 1, policyType: 1, householdId: 1 })
        .lean<
          {
            _id: Types.ObjectId;
            carrier?: string | null;
            policyNumber?: string | null;
            policyType?: string | null;
            householdId?: Types.ObjectId | null;
          }[]
        >()
    : [];
  const policyById = new Map(policies.map((row) => [String(row._id), row]));
  const chargebackDealIds = idsOf(chargebackRows.map((row) => row.dealId));
  const chargebackDeals = chargebackDealIds.length
    ? await models.deal.aggregate<{
        _id: Types.ObjectId;
        clientName?: string | null;
        householdId?: Types.ObjectId | null;
        sourceId?: Types.ObjectId | null;
      }>([
        { $match: { agencyId, _id: { $in: chargebackDealIds } } },
        ...sourceStages(true),
        { $project: { clientName: 1, householdId: 1, sourceId: 1 } },
      ])
    : [];
  const dealById = new Map(
    chargebackDeals.map((row) => [String(row._id), row]),
  );

  const names = await householdNames(models, agencyId, [
    ...idsOf(
      rows
        .filter((row) => !row.clientName?.trim())
        .map((row) => row.householdId),
    ),
    ...idsOf(
      chargebackRows.flatMap((row) => [
        row.householdId,
        row.policyId ? policyById.get(String(row.policyId))?.householdId : null,
        row.dealId ? dealById.get(String(row.dealId))?.householdId : null,
      ]),
    ),
  ]);

  for (const row of rows) {
    const userId = String(row.producerId);
    const sale: PayoutSale = {
      dealId: String(row._id),
      soldDate: row.soldDate.toISOString(),
      soldDay: businessDay(row.soldDate, timeZone) ?? '',
      clientName:
        row.clientName?.trim() ||
        (row.householdId ? names.get(String(row.householdId)) : null) ||
        UNNAMED_CLIENT,
      policyTypes: row.policyTypes ?? [],
      leadSourceId: row.sourceId ? String(row.sourceId) : null,
      lines: row.lines.map((line) => ({
        carrier: line.carrier ?? null,
        policyType: line.policyType ?? null,
        premium: line.premium ?? 0,
        typed: line.typed,
      })),
    };
    inputs.sales.set(userId, [...(inputs.sales.get(userId) ?? []), sale]);
  }

  for (const row of chargebackRows) {
    const userId = String(row.producerId);
    const policy = row.policyId
      ? policyById.get(String(row.policyId))
      : undefined;
    const deal = row.dealId ? dealById.get(String(row.dealId)) : undefined;
    const householdId =
      row.householdId ?? policy?.householdId ?? deal?.householdId;
    const chargeback: PayoutChargeback = {
      chargebackId: String(row._id),
      policyId: row.policyId ? String(row.policyId) : null,
      policyNumber: row.policyNumber ?? policy?.policyNumber ?? null,
      policyType: row.policyType ?? policy?.policyType ?? null,
      carrier: row.carrier?.trim() || policy?.carrier || null,
      leadSourceId: deal?.sourceId ? String(deal.sourceId) : null,
      customerName:
        deal?.clientName?.trim() ||
        (householdId ? names.get(String(householdId)) : null) ||
        row.customerName?.trim() ||
        null,
      amount: Math.abs(row.amount ?? 0),
      occurredAt: row.occurredAt.toISOString(),
      occurredDay: businessDay(row.occurredAt, timeZone) ?? '',
      reason: row.reason,
      source: row.source ?? 'app',
    };
    inputs.chargebacks.set(userId, [
      ...(inputs.chargebacks.get(userId) ?? []),
      chargeback,
    ]);
  }

  // Compliance: the month's sales whose audit failed (one count per sale).
  const dealOwner = new Map(
    rows.map((row) => [String(row._id), String(row.producerId)]),
  );
  if (dealOwner.size) {
    const failed = await models.dealAudit
      .find({
        agencyId,
        dealId: { $in: rows.map((row) => row._id) },
        auditStatus: 'Fail',
      })
      .select({ dealId: 1 })
      .lean<{ dealId: Types.ObjectId }[]>();
    for (const dealId of new Set(failed.map((row) => String(row.dealId)))) {
      const userId = dealOwner.get(dealId);
      if (userId) {
        inputs.failedAudits.set(
          userId,
          (inputs.failedAudits.get(userId) ?? 0) + 1,
        );
      }
    }
  }

  return inputs;
}

/**
 * The agency's sold premium for the month — every producer, on a structure
 * or not: what the team bonus levels are measured against. The Owner
 * dashboard's "Total bound premium" for the same month.
 */
export async function agencyGrossPremium(
  dealModel: Model<Deal>,
  agencyId: string,
  window: InstantWindow,
): Promise<number> {
  const [row] = await dealModel.aggregate<{ premium: number }>([
    ...linesPrefix(soldInMonth(agencyId, window), SOLD_LINES, {}, false),
    { $group: { _id: null, premium: { $sum: '$linePremium' } } },
  ]);
  return Math.round((row?.premium ?? 0) * 100) / 100;
}

/**
 * The agency's appointed carriers by name (A14): every one is listed on a
 * statement, sold or not. An appointment marked inactive is not.
 */
export async function appointedCarrierNames(
  carrierModel: Model<Carrier>,
  appointments:
    | readonly { carrierId?: Types.ObjectId | null; active?: boolean }[]
    | null
    | undefined,
): Promise<string[]> {
  const ids = idsOf(
    (appointments ?? [])
      .filter((appointment) => appointment.active !== false)
      .map((appointment) => appointment.carrierId),
  );
  if (!ids.length) return [];
  const carriers = await carrierModel
    .find({ _id: { $in: ids } })
    .select({ name: 1 })
    .lean<{ name: string }[]>();
  return carriers
    .map((carrier) => carrier.name)
    .sort((a, b) => a.localeCompare(b));
}
