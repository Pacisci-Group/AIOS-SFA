import { normalizeCarrier } from '@sfa/shared';
import { Types, type Model } from 'mongoose';
import {
  addDays,
  customRange,
  instantWindow,
  parseIsoDate,
  toIsoDate,
} from '../../performance/performance.range';
import { businessDay } from '../dates/business-dates';
import { displayName } from '../domain/user-names';
import { reconciliationPolicyKey } from './dash-file-reader';
import type { StaffCodes } from './producer-code-index';
import type { AppPolicyLite, ReportWindow } from './reconcile';
import {
  DASH_CARRIER_NAMES,
  RECONCILIATION_WINDOW_PAD_DAYS,
} from './reconciliation-file-types';

/**
 * Everything a run reads from Mongo, behind a models bag — the
 * `common/data-export` pattern, so a worker job can run a reconciliation
 * without importing a feature service.
 *
 * Every query pins `agencyId` (a **string** on deals and policies; an
 * **ObjectId** on the agency and on users) and drops `isTestRecord` where the
 * collection has it.
 */

type AnyModel = Model<any>;

export interface ReconciliationModels {
  deal: AnyModel;
  policy: AnyModel;
  agency: AnyModel;
  carrier: AnyModel;
  user: AnyModel;
}

export interface AllstateContext {
  carrierId: Types.ObjectId;
  /** The agency's active Allstate agent codes, as `codeKey`s. */
  agencyCodes: string[];
}

/** The global Allstate catalog row and the agency's Allstate appointments. */
export async function resolveAllstate(
  models: ReconciliationModels,
  agencyId: string,
): Promise<AllstateContext | null> {
  const carrier = await models.carrier
    .findOne({ agencyId: null, slug: 'allstate' }, { _id: 1 })
    .lean<{ _id: Types.ObjectId }>();
  if (!carrier) return null;

  const agency = await models.agency
    .findById(new Types.ObjectId(agencyId), { carrierAppointments: 1 })
    .lean<{
      carrierAppointments?: {
        carrierId: Types.ObjectId;
        codeKey?: string;
        active?: boolean;
      }[];
    }>();
  // `.lean()` skips the schema's `[]` default on a document that predates it.
  const agencyCodes = (agency?.carrierAppointments ?? [])
    .filter(
      (appointment) =>
        appointment.active !== false &&
        String(appointment.carrierId) === String(carrier._id) &&
        typeof appointment.codeKey === 'string',
    )
    .map((appointment) => appointment.codeKey!);
  return { carrierId: carrier._id, agencyCodes };
}

/**
 * Whether the report's agent number is one of the agency's Allstate codes.
 *
 * Dash prints `0B9049`; the appointment is recorded as issued, `A0B9049`.
 * The leading `A` of a seven-character code is Allstate's agent prefix, so it
 * is dropped on both sides before comparing.
 */
export function agentNumberMatches(
  agentNumber: string,
  agencyCodes: readonly string[],
): boolean {
  const strip = (code: string) =>
    code
      .trim()
      .toUpperCase()
      .replace(/^A(?=[0-9A-Z]{6}$)/, '');
  const wanted = strip(agentNumber);
  return agencyCodes.some((code) => strip(code) === wanted);
}

/**
 * Every user of the agency holding an Allstate code — **deactivated users
 * included**: a leaver's Bind ID still names who bound their old sales, and
 * dropping it would credit those lines to Dash's printed name instead of the
 * user (or, on a line Dash leaves unnamed, read them as 1-800). Pending invites
 * count too; their codes were typed by the inviter on purpose.
 */
export async function loadStaffCodes(
  models: ReconciliationModels,
  agencyId: string,
): Promise<StaffCodes[]> {
  const users = await models.user
    .find(
      {
        agencyId: new Types.ObjectId(agencyId),
        isPlatformAdmin: { $ne: true },
        $or: [
          { allstateBindId: { $type: 'string' } },
          { allstateSubProducerCode: { $type: 'string' } },
        ],
      },
      {
        firstName: 1,
        lastName: 1,
        email: 1,
        allstateBindId: 1,
        allstateSubProducerCode: 1,
      },
    )
    .lean<
      {
        _id: Types.ObjectId;
        firstName?: string;
        lastName?: string;
        email: string;
        allstateBindId?: string;
        allstateSubProducerCode?: string;
      }[]
    >();
  return users.map((user) => ({
    userId: String(user._id),
    name: displayName(user),
    bindId: user.allstateBindId ?? null,
    subProducerCode: user.allstateSubProducerCode ?? null,
  }));
}

const COVERED_CARRIERS = new Set(
  DASH_CARRIER_NAMES.map((name) => name.toLowerCase()),
);

/** A blank carrier counts: an exclusive Allstate agency's untyped policy is Allstate's. */
function carrierCovered(carrier: string | null | undefined): boolean {
  const name = normalizeCarrier(carrier).toLowerCase();
  return !name || COVERED_CARRIERS.has(name);
}

interface PolicyRow {
  _id: Types.ObjectId;
  policyNumber?: string;
  policyType?: string;
  carrier?: string;
  policyStatus?: string;
  premium?: number;
  items?: number;
  dealId?: Types.ObjectId;
  householdId?: Types.ObjectId;
}

interface DealRow {
  _id: Types.ObjectId;
  soldDate?: Date;
  producerId?: Types.ObjectId;
  householdId?: Types.ObjectId;
  clientName?: string;
  businessType?: string;
}

const POLICY_PROJECTION = {
  policyNumber: 1,
  policyType: 1,
  carrier: 1,
  policyStatus: 1,
  premium: 1,
  items: 1,
  dealId: 1,
  householdId: 1,
} as const;

const DEAL_PROJECTION = {
  soldDate: 1,
  producerId: 1,
  householdId: 1,
  clientName: 1,
  businessType: 1,
} as const;

/**
 * The app's side of a reconciliation:
 *
 * - every policy on a deal sold within the report period **padded** by
 *   {@link RECONCILIATION_WINDOW_PAD_DAYS} either side (candidates for
 *   "not in Dash" and for suggestions), and
 * - every policy anywhere in the agency whose number matches a line of the
 *   report, however long ago it was sold — a late-entered or back-dated sale
 *   is still found.
 *
 * Keys are computed here rather than read from `policyNumberKey`, because the
 * reconciliation key also drops a National General term suffix that the
 * stored key keeps. A projection of `{_id, policyNumber}` over an agency's
 * book is a few thousand small documents.
 */
export async function loadAppPolicies(
  models: ReconciliationModels,
  {
    agencyId,
    timeZone,
    window,
    dashKeys,
  }: {
    agencyId: string;
    timeZone: string;
    window: ReportWindow;
    dashKeys: ReadonlySet<string>;
  },
): Promise<AppPolicyLite[]> {
  const tenant = { agencyId, isTestRecord: { $ne: true } };
  const padded: ReportWindow = {
    from: toIsoDate(
      addDays(parseIsoDate(window.from), -RECONCILIATION_WINDOW_PAD_DAYS),
    ),
    to: toIsoDate(
      addDays(parseIsoDate(window.to), RECONCILIATION_WINDOW_PAD_DAYS),
    ),
  };

  const windowDeals = await models.deal
    .find(
      {
        ...tenant,
        soldDate: instantWindow(customRange(padded.from, padded.to), timeZone),
      },
      DEAL_PROJECTION,
    )
    .lean<DealRow[]>();
  const dealsById = new Map(
    windowDeals.map((deal) => [String(deal._id), deal]),
  );

  const policies = new Map<string, PolicyRow>();
  if (windowDeals.length) {
    const rows = await models.policy
      .find(
        { ...tenant, dealId: { $in: windowDeals.map((deal) => deal._id) } },
        POLICY_PROJECTION,
      )
      .lean<PolicyRow[]>();
    for (const row of rows) policies.set(String(row._id), row);
  }

  if (dashKeys.size) {
    const numbered = await models.policy
      .find(
        { ...tenant, policyNumber: { $type: 'string', $ne: '' } },
        { policyNumber: 1 },
      )
      .lean<{ _id: Types.ObjectId; policyNumber: string }[]>();
    const wanted = numbered
      .filter(
        (row) =>
          !policies.has(String(row._id)) &&
          dashKeys.has(reconciliationPolicyKey(row.policyNumber)),
      )
      .map((row) => row._id);
    if (wanted.length) {
      const rows = await models.policy
        .find({ ...tenant, _id: { $in: wanted } }, POLICY_PROJECTION)
        .lean<PolicyRow[]>();
      for (const row of rows) policies.set(String(row._id), row);
    }
  }

  const missingDeals = [
    ...new Set(
      [...policies.values()]
        .map((policy) => (policy.dealId ? String(policy.dealId) : null))
        .filter((id): id is string => !!id && !dealsById.has(id)),
    ),
  ];
  if (missingDeals.length) {
    const rows = await models.deal
      .find(
        {
          ...tenant,
          _id: { $in: missingDeals.map((id) => new Types.ObjectId(id)) },
        },
        DEAL_PROJECTION,
      )
      .lean<DealRow[]>();
    for (const row of rows) dealsById.set(String(row._id), row);
  }

  return [...policies.values()].map((policy) => {
    const deal = policy.dealId
      ? dealsById.get(String(policy.dealId))
      : undefined;
    const soldDay = deal ? businessDay(deal.soldDate, timeZone) : null;
    const within = (range: ReportWindow) =>
      !!soldDay && soldDay >= range.from && soldDay <= range.to;
    const householdId = policy.householdId ?? deal?.householdId;
    return {
      policyId: String(policy._id),
      policyNumber: policy.policyNumber?.trim() || null,
      policyKey: reconciliationPolicyKey(policy.policyNumber),
      policyType: policy.policyType ?? null,
      carrier: policy.carrier ? normalizeCarrier(policy.carrier) : null,
      policyStatus: policy.policyStatus ?? null,
      premium: policy.premium ?? 0,
      items: policy.items ?? 0,
      dealId: deal ? String(deal._id) : null,
      householdId: householdId ? String(householdId) : null,
      producerId: deal?.producerId ? String(deal.producerId) : null,
      soldDay,
      clientName: deal?.clientName?.trim() || null,
      businessType: deal?.businessType ?? null,
      // A company transfer counts: it writes a new policy, which Dash lists
      // as a new issue like any sale. The data team's scrubber counts it too.
      expectedInDash:
        !!deal && within(window) && carrierCovered(policy.carrier),
      nearWindow: within(padded),
    };
  });
}
