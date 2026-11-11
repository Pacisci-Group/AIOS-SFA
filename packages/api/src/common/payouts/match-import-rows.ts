import {
  carrierSlug,
  normalizeCarrier,
  policyNumberKey,
  type ChargebackReason,
  type ChargebackSource,
  type ImportMatchSignal,
  type ImportRowNote,
  type ImportRowResolution,
} from '@sfa/shared';
import { Types, type ClientSession, type Model } from 'mongoose';
import type { Chargeback } from '../../chargebacks/schemas/chargeback.schema';
import type { Deal } from '../../deals/schemas/deal.schema';
import type { Policy } from '../../policies/schemas/policy.schema';
import type { UserDocument } from '../../users/schemas/user.schema';
import { businessDateInstant } from '../dates/business-dates';
import type { ChargebackFileRow } from './chargeback-file-reader';

/**
 * Matches the lines of a chargeback report to people and policies (PAC-180).
 *
 * ## Who is charged
 *
 * Three signals can name a person, and they are weighed together (owner,
 * 5 Nov 2026 — "use the producer name and the policy number"):
 *
 * - the **SOK number** (`User.allstateBindId`), when the report has one — an
 *   identifier, so it decides on its own;
 * - the **Producer** the report names, matched to exactly one user by full
 *   name;
 * - the **policy's seller** — the producer on the deal the app sold the policy
 *   on, found by policy number.
 *
 * {@link resolvePerson} is the rule. When the name and the seller agree, or
 * only one of them finds anybody, the line is matched and its notes say which
 * signal decided. When they name different people the line **needs a
 * person**: both are offered, and the owner chooses. People who have left are
 * matched like anyone else — a chargeback can follow a producer out the door.
 *
 * ## Duplicates — a policy is charged back once
 *
 * A line whose policy already has a chargeback — **in any month, from any
 * source** (an app cancellation or rewrite, a line of an earlier report) — is a
 * `duplicate`, and so is a line repeating a policy an earlier line of the same
 * file charges. The original stands and the line names it; a duplicate is
 * never charged and the owner cannot change that (owner, 6 Nov 2026: "you
 * can't charge back twice"). This beats the person match: a duplicate never
 * needs a person.
 *
 * A line whose amount has the opposite sign to the rest of the report is a
 * reversal, not a chargeback: it is `skipped`, and it never makes a later line
 * of the same policy a repeat.
 *
 * The same check runs again inside the commit ({@link existingChargebacks}),
 * because the ledger may have moved since the preview was made.
 *
 * In `common/` beside the parser and the engine; the API's import service is
 * its only caller.
 */

export interface ImportMatchModels {
  user: Model<UserDocument>;
  policy: Model<Policy>;
  deal: Model<Deal>;
  chargeback: Model<Chargeback>;
}

/** What matching found for a line; stored on the import row. */
export interface ImportRowMatch {
  sokUserId: Types.ObjectId | null;
  nameUserId: Types.ObjectId | null;
  sellerUserId: Types.ObjectId | null;
  candidates: { userId: Types.ObjectId; via: ImportMatchSignal }[];
  policyId: Types.ObjectId | null;
  dealId: Types.ObjectId | null;
  householdId: Types.ObjectId | null;
  /** The policy's or the sale's branch — the ledger row's, when there is one. */
  branchId: string | null;
  /** The app's spelling of the number, and its type and carrier. */
  policyNumber: string | null;
  policyType: string | null;
  carrier: string | null;
  /** The sale's client name, which beats the report's on a statement. */
  clientName: string | null;
  /** The sale's sold date, else the report's (agency-local midnight). */
  soldDate: Date | null;
  /** The chargeback already on this policy — the original a duplicate keeps. */
  existingChargeback: ExistingChargeback | null;
  /** The earlier line of this file that charges the same policy. */
  repeatOfRow: number | null;
}

/** A ledger row already on a line's policy, as the preview names it. */
export interface ExistingChargeback {
  id: Types.ObjectId;
  reason: ChargebackReason;
  source: ChargebackSource;
  amount: number;
  occurredAt: Date;
  statementMonth: string | null;
  /**
   * Who it was charged to. A manual line names them only when it is the
   * statement's own employee (PAC-182 review): a reviewer may not see others.
   */
  producerId: Types.ObjectId | null;
  producerName: string;
}

export interface MatchedImportRow extends Omit<ChargebackFileRow, 'carrier'> {
  /** The carrier as the report gives it. */
  fileCarrier: string | null;
  /** The policy's carrier, else the report's, else the import's. */
  carrier: string;
  match: ImportRowMatch;
  autoUserId: Types.ObjectId | null;
  autoResolution: ImportRowResolution;
  notes: ImportRowNote[];
}

/** What {@link resolvePerson} is told about one line. */
export interface PersonSignals {
  /** The report gave a SOK number / a producer name. */
  sokGiven: boolean;
  nameGiven: boolean;
  /** The user each signal found (by id), if any. */
  sokUser: string | null;
  nameUser: string | null;
  /** More than one user has the report's name. */
  nameAmbiguous: boolean;
  /** The app holds the policy / it has a sale with a producer. */
  policyFound: boolean;
  seller: string | null;
}

export interface ResolvedPerson {
  userId: string | null;
  resolution: Extract<ImportRowResolution, 'matched' | 'unmatched'>;
  notes: ImportRowNote[];
  candidates: { userId: string; via: ImportMatchSignal }[];
}

/**
 * Who a line charges, from the three signals.
 *
 * | SOK user | name → user | policy's seller | result |
 * |---|---|---|---|
 * | found | any | any | matched → SOK user |
 * | none | A | A | matched → A |
 * | none | A | none | matched → A |
 * | none | none | B | matched → B (`seller_used`) |
 * | none | A | B ≠ A | needs a person (`name_seller_differ`) |
 * | none | none | none | needs a person |
 */
export function resolvePerson(signals: PersonSignals): ResolvedPerson {
  const notes: ImportRowNote[] = [];
  if (signals.sokGiven && !signals.sokUser) notes.push('sok_unknown');
  if (signals.nameGiven && signals.nameAmbiguous) notes.push('name_ambiguous');
  else if (signals.nameGiven && !signals.nameUser) notes.push('name_unknown');
  if (!signals.policyFound) notes.push('policy_not_found');
  else if (!signals.seller) notes.push('policy_no_sale');

  const candidates: ResolvedPerson['candidates'] = [];
  const offer = (userId: string | null, via: ImportMatchSignal) => {
    if (userId && !candidates.some((c) => c.userId === userId)) {
      candidates.push({ userId, via });
    }
  };
  offer(signals.sokUser, 'sok');
  offer(signals.nameUser, 'name');
  offer(signals.seller, 'policy');

  const matched = (userId: string): ResolvedPerson => ({
    userId,
    resolution: 'matched',
    notes,
    candidates,
  });

  if (signals.sokUser) {
    if (signals.seller && signals.seller !== signals.sokUser) {
      notes.push('sok_seller_differ');
    }
    return matched(signals.sokUser);
  }
  if (signals.nameUser && signals.seller) {
    if (signals.nameUser === signals.seller) return matched(signals.nameUser);
    notes.push('name_seller_differ');
    return { userId: null, resolution: 'unmatched', notes, candidates };
  }
  if (signals.nameUser) return matched(signals.nameUser);
  if (signals.seller) {
    notes.push('seller_used');
    return matched(signals.seller);
  }
  return { userId: null, resolution: 'unmatched', notes, candidates };
}

/**
 * A person's name as a match key: lower-case, accents and punctuation
 * dropped, spaces collapsed. `Yates, Jessica` reads as `jessica yates`.
 * `null` for a blank name.
 */
export function personNameKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let text = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const comma = text.indexOf(',');
  if (comma !== -1) {
    text = `${text.slice(comma + 1)} ${text.slice(0, comma)}`;
  }
  const key = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return key || null;
}

interface LeanUser {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  allstateBindId?: string | null;
}

interface LeanPolicy {
  _id: Types.ObjectId;
  policyNumber?: string | null;
  policyNumberKey?: string | null;
  policyType?: string | null;
  carrier?: string | null;
  householdId?: Types.ObjectId | null;
  dealId?: Types.ObjectId | null;
  branchId?: string | null;
}

interface LeanDeal {
  _id: Types.ObjectId;
  producerId?: Types.ObjectId | null;
  clientName?: string | null;
  soldDate?: Date | null;
  branchId?: string | null;
  householdId?: Types.ObjectId | null;
}

/** Match every line; a fixed number of queries, whatever the line count. */
export async function matchImportRows(
  models: ImportMatchModels,
  args: {
    agencyId: string;
    timeZone: string;
    /** The import's carrier, for lines that name none and match no policy. */
    carrier: string;
    rows: readonly ChargebackFileRow[];
  },
): Promise<MatchedImportRow[]> {
  const { agencyId, timeZone, rows } = args;
  const importCarrier = normalizeCarrier(args.carrier);

  // People — every agency user, removed ones included.
  const users = await models.user
    .find({
      agencyId: new Types.ObjectId(agencyId),
      isPlatformAdmin: { $ne: true },
    })
    .select({ firstName: 1, lastName: 1, allstateBindId: 1 })
    .lean<LeanUser[]>();
  const byBindId = new Map<string, Types.ObjectId>();
  const byName = new Map<string, Types.ObjectId[]>();
  for (const user of users) {
    if (user.allstateBindId) byBindId.set(user.allstateBindId, user._id);
    const key = personNameKey(
      [user.firstName, user.lastName].filter(Boolean).join(' '),
    );
    if (key) byName.set(key, [...(byName.get(key) ?? []), user._id]);
  }

  const { policiesByKey, dealById } = await policiesByNumber(
    models,
    agencyId,
    rows.map((row) => row.policyNumber),
  );

  const picked = rows.map((row) =>
    pickPolicy(
      policiesByKey.get(policyNumberKey(row.policyNumber)) ?? [],
      row.carrier ?? importCarrier,
    ),
  );
  const charged = await existingChargebacks(models.chargeback, agencyId, {
    policyIds: picked.flatMap((policy) => (policy ? [policy._id] : [])),
    numberKeys: rows.map((row) => policyNumberKey(row.policyNumber)),
  });

  // The policy each line charges — the first line to name it claims it.
  const claimedBy = new Map<string, number>();

  return rows.map((row, index) => {
    const key = policyNumberKey(row.policyNumber);
    const policy = picked[index];
    const deal = policy?.dealId ? dealById.get(String(policy.dealId)) : null;

    const sokUser = row.bindId ? (byBindId.get(row.bindId) ?? null) : null;
    const named = byName.get(personNameKey(row.producerName) ?? '') ?? [];
    const nameUser = named.length === 1 ? named[0] : null;
    const seller = deal?.producerId ?? null;

    const resolved = resolvePerson({
      sokGiven: Boolean(row.bindId),
      nameGiven: Boolean(row.producerName),
      sokUser: sokUser ? String(sokUser) : null,
      nameUser: nameUser ? String(nameUser) : null,
      nameAmbiguous: named.length > 1,
      policyFound: Boolean(policy),
      seller: seller ? String(seller) : null,
    });

    const existing = charged.find(policy?._id ?? null, key);
    const identity = policyIdentity(policy?._id ?? null, key);
    const repeatOfRow = existing ? null : (claimedBy.get(identity) ?? null);
    const notes = [...resolved.notes];
    let autoResolution: ImportRowResolution = resolved.resolution;
    if (existing) {
      notes.push('already_charged');
      autoResolution = 'duplicate';
    } else if (repeatOfRow !== null) {
      notes.push('repeated_in_file');
      autoResolution = 'duplicate';
    } else if (row.oppositeSign) {
      notes.push('opposite_sign');
      autoResolution = 'skipped';
    } else {
      claimedBy.set(identity, row.rowNumber);
    }

    const policyCarrier = policy?.carrier
      ? normalizeCarrier(policy.carrier)
      : null;
    const { carrier: fileCarrier, ...fields } = row;
    return {
      ...fields,
      fileCarrier,
      carrier:
        policyCarrier ||
        (fileCarrier ? normalizeCarrier(fileCarrier) : '') ||
        importCarrier,
      match: {
        sokUserId: sokUser,
        nameUserId: nameUser,
        sellerUserId: seller,
        candidates: resolved.candidates.map((c) => ({
          userId: new Types.ObjectId(c.userId),
          via: c.via,
        })),
        policyId: policy?._id ?? null,
        dealId: deal?._id ?? null,
        householdId: policy?.householdId ?? deal?.householdId ?? null,
        branchId: policy?.branchId || deal?.branchId || null,
        policyNumber: policy?.policyNumber ?? null,
        policyType: policy?.policyType ?? null,
        carrier: policyCarrier,
        clientName: deal?.clientName?.trim() || null,
        soldDate:
          deal?.soldDate ??
          (row.soldDay ? businessDateInstant(row.soldDay, timeZone) : null),
        existingChargeback: existing,
        repeatOfRow,
      },
      autoUserId: resolved.userId ? new Types.ObjectId(resolved.userId) : null,
      autoResolution,
      notes,
    };
  });
}

/**
 * The agency's policies holding any of `numbers`, by their stored number
 * key (every writer sets it; migration `20261106120000-policy_number_keys`
 * filled in the rows that lacked one), newest first — and their sales.
 */
async function policiesByNumber(
  models: Pick<ImportMatchModels, 'policy' | 'deal'>,
  agencyId: string,
  numbers: readonly (string | null | undefined)[],
): Promise<{
  policiesByKey: Map<string, LeanPolicy[]>;
  dealById: Map<string, LeanDeal>;
}> {
  const keys = [
    ...new Set(numbers.map((number) => policyNumberKey(number))),
  ].filter(Boolean);
  const policies = keys.length
    ? await models.policy
        .find({
          agencyId,
          policyNumberKey: { $in: keys },
          isTestRecord: { $ne: true },
        })
        .select({
          policyNumber: 1,
          policyNumberKey: 1,
          policyType: 1,
          carrier: 1,
          householdId: 1,
          dealId: 1,
          branchId: 1,
        })
        .sort({ _id: -1 })
        .lean<LeanPolicy[]>()
    : [];
  const policiesByKey = new Map<string, LeanPolicy[]>();
  for (const policy of policies) {
    const key = policy.policyNumberKey ?? '';
    policiesByKey.set(key, [...(policiesByKey.get(key) ?? []), policy]);
  }
  const dealIds = [
    ...new Set(
      policies
        .map((policy) => policy.dealId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const deals = dealIds.length
    ? await models.deal
        .find({ agencyId, _id: { $in: dealIds } })
        .select({
          producerId: 1,
          clientName: 1,
          soldDate: 1,
          branchId: 1,
          householdId: 1,
        })
        .lean<LeanDeal[]>()
    : [];
  return {
    policiesByKey,
    dealById: new Map(deals.map((deal) => [String(deal._id), deal])),
  };
}

/** A policy the app holds, found by its number, and the sale it was on. */
export interface PolicyByNumber {
  policyId: Types.ObjectId;
  policyNumber: string | null;
  policyType: string | null;
  carrier: string | null;
  householdId: Types.ObjectId | null;
  dealId: Types.ObjectId | null;
  clientName: string | null;
  soldDate: Date | null;
}

/**
 * The policy a number means, as a report line's would be found (PAC-182's
 * manual chargeback): the given carrier first, then one with a sale, then
 * the newest. `null` when the app holds no policy with that number.
 */
export async function findPolicyByNumber(
  models: Pick<ImportMatchModels, 'policy' | 'deal'>,
  agencyId: string,
  policyNumber: string,
  carrier: string | null,
): Promise<PolicyByNumber | null> {
  const { policiesByKey, dealById } = await policiesByNumber(models, agencyId, [
    policyNumber,
  ]);
  const policy = pickPolicy(
    policiesByKey.get(policyNumberKey(policyNumber)) ?? [],
    carrier ?? '',
  );
  if (!policy) return null;
  const deal = policy.dealId ? dealById.get(String(policy.dealId)) : null;
  return {
    policyId: policy._id,
    policyNumber: policy.policyNumber ?? null,
    policyType: policy.policyType ?? null,
    carrier: policy.carrier ?? null,
    householdId: policy.householdId ?? deal?.householdId ?? null,
    dealId: deal?._id ?? null,
    clientName: deal?.clientName?.trim() || null,
    soldDate: deal?.soldDate ?? null,
  };
}

/**
 * Of the policies holding a number, the one a line means: the report's
 * carrier first (carriers reuse numbers), then one with a sale, then the
 * newest. Carriers compare as slugs of their canonical names, so `ALLSTATE`,
 * `Allstate` and the stored code `B4tEH` are one carrier.
 */
function pickPolicy(
  candidates: LeanPolicy[],
  carrier: string,
): LeanPolicy | null {
  if (!candidates.length) return null;
  const wanted = carrierKey(carrier);
  const score = (policy: LeanPolicy) =>
    (wanted && carrierKey(policy.carrier) === wanted ? 2 : 0) +
    (policy.dealId ? 1 : 0);
  // Stable over the query's newest-first order.
  return [...candidates].sort((a, b) => score(b) - score(a))[0];
}

function carrierKey(carrier: string | null | undefined): string {
  return carrier ? carrierSlug(normalizeCarrier(carrier)) : '';
}

/** One policy, whether the app holds it (by id) or not (by number key). */
export function policyIdentity(
  policyId: Types.ObjectId | string | null,
  key: string,
): string {
  return policyId ? `policy:${String(policyId)}` : `number:${key}`;
}

/** Ledger rows already on some policies, and how to find a line's. */
export interface ChargedPolicies {
  /** The earliest chargeback on the policy (by id), else on the number. */
  find(
    policyId: Types.ObjectId | string | null,
    key: string,
  ): ExistingChargeback | null;
}

interface LeanLedgerRow {
  _id: Types.ObjectId;
  policyId?: Types.ObjectId | null;
  policyNumber?: string | null;
  reason: ChargebackReason;
  source?: ChargebackSource | null;
  amount: number;
  occurredAt: Date;
  statementMonth?: string | null;
  producerId?: Types.ObjectId | null;
  producerName?: string | null;
}

/**
 * The chargebacks already on these policies, in any month: rows naming the
 * policy, and rows that name no policy (the app did not hold it) carrying
 * one of `numberKeys`. Both reads are indexed. A policy-less row with no
 * stored key — one written before the key was — is read whatever its
 * number, and matched by the number it shows, so a missing key costs a read
 * and never a second charge. With a session, inside the caller's
 * transaction.
 */
export async function existingChargebacks(
  model: Model<Chargeback>,
  agencyId: string,
  {
    policyIds,
    numberKeys,
  }: {
    policyIds: readonly Types.ObjectId[];
    numberKeys: readonly string[];
  },
  session: ClientSession | null = null,
): Promise<ChargedPolicies> {
  const keys = [...new Set(numberKeys)].filter(Boolean);
  const fields = {
    policyId: 1,
    policyNumber: 1,
    reason: 1,
    source: 1,
    amount: 1,
    occurredAt: 1,
    statementMonth: 1,
    producerId: 1,
    producerName: 1,
  };
  const [onPolicies, unattached] = await Promise.all([
    policyIds.length
      ? model
          .find({ agencyId, policyId: { $in: policyIds } })
          .select(fields)
          .sort({ occurredAt: 1, _id: 1 })
          .session(session)
          .lean<LeanLedgerRow[]>()
      : Promise.resolve([] as LeanLedgerRow[]),
    model
      .find({
        agencyId,
        policyId: null,
        // `null` also matches a row with no key at all.
        policyNumberKey: { $in: [...keys, null] },
      })
      .select(fields)
      .sort({ occurredAt: 1, _id: 1 })
      .session(session)
      .lean<LeanLedgerRow[]>(),
  ]);
  const byPolicy = new Map<string, LeanLedgerRow>();
  for (const row of onPolicies) {
    const id = String(row.policyId);
    if (!byPolicy.has(id)) byPolicy.set(id, row);
  }
  const byNumber = new Map<string, LeanLedgerRow>();
  for (const row of unattached) {
    const key = policyNumberKey(row.policyNumber);
    if (key && !byNumber.has(key)) byNumber.set(key, row);
  }
  const view = (row: LeanLedgerRow | undefined): ExistingChargeback | null =>
    row
      ? {
          id: row._id,
          reason: row.reason,
          source: row.source ?? 'app',
          amount: row.amount,
          occurredAt: row.occurredAt,
          statementMonth: row.statementMonth ?? null,
          producerId: row.producerId ?? null,
          producerName: row.producerName ?? '',
        }
      : null;
  return {
    find: (policyId, key) =>
      view(
        (policyId ? byPolicy.get(String(policyId)) : undefined) ??
          (key ? byNumber.get(key) : undefined),
      ),
  };
}
