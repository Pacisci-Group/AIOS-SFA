import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  roundHours,
  type LeaveLedgerKind,
  type LeaveLedgerReason,
  type LeaveLedgerSourceKind,
} from '@sfa/shared';
import { ClientSession, Model, Types } from 'mongoose';
import {
  LeaveLedger,
  type LeaveLedgerDocument,
} from '../../hr/schemas/leave-ledger.schema';
import { businessDateInstant } from '../dates/business-dates';

/** A row before it is written. */
export interface NewLedgerRow {
  agencyId: string;
  policyId: Types.ObjectId;
  userId: Types.ObjectId;
  kind: LeaveLedgerKind;
  hours: number;
  effectiveAt: Date;
  periodKey?: string | null;
  reason?: LeaveLedgerReason | null;
  source: { kind: LeaveLedgerSourceKind; id: Types.ObjectId | null };
  reversesId?: Types.ObjectId | null;
  /** Free text: the reason an admin gave for a manual adjustment. */
  note?: string | null;
}

/** A person's hours in a policy, split at an instant. */
export interface LedgerBalance {
  /** Everything that has happened by the as-of instant. */
  current: number;
  /**
   * Approved leave dated from the as-of instant on — a positive number of
   * hours, already net of reversals. Not part of `current`.
   */
  upcoming: number;
}

/** The request-driven rows of one person in one policy. */
export interface RequestLedgerTarget {
  agencyId: string;
  policyId: Types.ObjectId;
  userId: Types.ObjectId;
  requestId: Types.ObjectId;
}

/** Net leave on one day, as the ledger holds it. */
export interface LedgerLeaveDay {
  effectiveAt: Date;
  /** The request the rows belong to; null for rows with no request behind them. */
  requestId: Types.ObjectId | null;
  /** Positive hours of leave, net of reversals. */
  hours: number;
}

/** The kinds a request writes — the only rows ever dated in the future. */
const LEAVE_KINDS: LeaveLedgerKind[] = ['used', 'reversal'];

const usedKey = (requestId: Types.ObjectId, date: string) =>
  `used:${requestId.toString()}:${date}`;
const reversalKey = (usedPeriodKey: string) =>
  usedPeriodKey.replace(/^used:/, 'reversal:');

/**
 * The one writer and reader of `leaveLedger` (PAC-174). Lives in `common/`
 * so the accrual job in the worker and the HR policies service share it.
 *
 * Append-only: there is no update path here and there must never be one.
 * PAC-165 added the request-driven writers (`postUsed`, `postReversal`,
 * `postAdjustment`) as methods on this class, not a second service.
 *
 * ## Sessions
 *
 * The writers a request calls take an optional session, because approving a
 * request and posting its hours must commit together (`TransactionRunner`).
 * Await them one at a time — a session does not take concurrent operations.
 */
@Injectable()
export class LeaveLedgerService {
  constructor(
    @InjectModel(LeaveLedger.name)
    private readonly ledger: Model<LeaveLedgerDocument>,
  ) {}

  /** Hand-written rows: a starting balance, a removal. */
  async post(
    rows: NewLedgerRow[],
    session?: ClientSession | null,
  ): Promise<void> {
    if (!rows.length) return;
    await this.ledger.insertMany(
      rows.map((row) => ({
        ...row,
        hours: roundHours(row.hours),
        periodKey: row.periodKey ?? null,
        reason: row.reason ?? null,
        reversesId: row.reversesId ?? null,
        note: row.note ?? null,
      })),
      { session: session ?? undefined },
    );
  }

  /**
   * The hours of an approved (or recorded) request: one `used` row per leave
   * day, **dated on that day**. That is all a request spanning a reset
   * needs — its December days sit in the closing period and its January
   * days in the new one, with nothing split by hand.
   *
   * Each row's `periodKey` is `used:<requestId>:<date>`, so the partial
   * unique index makes posting a day twice impossible at the database. A
   * duplicate here is therefore an error, not a no-op: it means two
   * approvals got past the status claim, and the transaction must abort.
   */
  async postUsed(
    target: RequestLedgerTarget,
    days: readonly { date: string; hours: number }[],
    timeZone: string,
    session?: ClientSession | null,
  ): Promise<number> {
    const rows: NewLedgerRow[] = days
      .filter((day) => day.hours > 0)
      .map((day) => ({
        agencyId: target.agencyId,
        policyId: target.policyId,
        userId: target.userId,
        kind: 'used',
        hours: -day.hours,
        effectiveAt: businessDateInstant(day.date, timeZone),
        periodKey: usedKey(target.requestId, day.date),
        source: { kind: 'request', id: target.requestId },
      }));
    await this.post(rows, session);
    return rows.length;
  }

  /**
   * Undo an approved request: a `reversal` for each of its `used` rows, the
   * same hours with the sign turned, **on the same day**, linked through
   * `reversesId`. Dated on the leave day rather than today so the period the
   * leave was taken from is the period that gets it back.
   */
  async postReversal(
    target: RequestLedgerTarget,
    session?: ClientSession | null,
  ): Promise<number> {
    const used = await this.ledger
      .find({
        agencyId: target.agencyId,
        policyId: target.policyId,
        userId: target.userId,
        kind: 'used',
        'source.id': target.requestId,
        // Lets Mongo use the partial index; every `used` row has a key.
        periodKey: { $type: 'string' },
      })
      .select('hours effectiveAt periodKey')
      .session(session ?? null)
      .lean<
        {
          _id: Types.ObjectId;
          hours: number;
          effectiveAt: Date;
          periodKey: string;
        }[]
      >();
    await this.post(
      used.map((row) => ({
        agencyId: target.agencyId,
        policyId: target.policyId,
        userId: target.userId,
        kind: 'reversal',
        hours: -row.hours,
        effectiveAt: row.effectiveAt,
        periodKey: reversalKey(row.periodKey),
        source: { kind: 'request', id: target.requestId },
        reversesId: row._id,
      })),
      session,
    );
    return used.length;
  }

  /**
   * An HR admin's correction: signed hours, effective now, with the reason
   * they gave in `note`. Returns the row's id — the notification's dedupe
   * key, since two adjustments of the same hours are two events.
   */
  async postAdjustment(
    row: {
      agencyId: string;
      policyId: Types.ObjectId;
      userId: Types.ObjectId;
      hours: number;
      note: string;
      effectiveAt: Date;
    },
    session?: ClientSession | null,
  ): Promise<Types.ObjectId> {
    const [created] = await this.ledger.create(
      [
        {
          ...row,
          kind: 'manual_adjustment',
          hours: roundHours(row.hours),
          periodKey: null,
          reason: null,
          source: { kind: 'admin', id: null },
          reversesId: null,
        },
      ],
      { session: session ?? undefined },
    );
    return created._id;
  }

  /**
   * A job-written row, once per `periodKey`: an upsert keyed on the partial
   * unique index, so the second attempt — a retry, another replica, a
   * re-run — changes nothing. `true` when this call wrote it.
   */
  async postOnce(row: NewLedgerRow & { periodKey: string }): Promise<boolean> {
    const result = await this.ledger.updateOne(
      {
        policyId: row.policyId,
        userId: row.userId,
        kind: row.kind,
        periodKey: row.periodKey,
      },
      {
        $setOnInsert: {
          agencyId: row.agencyId,
          hours: roundHours(row.hours),
          effectiveAt: row.effectiveAt,
          reason: row.reason ?? null,
          source: row.source,
          reversesId: null,
        },
      },
      { upsert: true },
    );
    return result.upsertedCount > 0;
  }

  /**
   * Each person's hours in the policy, split at `asOf`. Someone with no rows
   * is absent from the map (read as zero by a caller that knows they are
   * enrolled).
   *
   * The balance is the sum of a person's rows — but a `used` row is dated on
   * its leave day, which can be months away, so "the sum" needs a date.
   * Only request rows (`used`, `reversal`) are ever dated in the future;
   * every other kind is effective when it is written. So `upcoming` is the
   * request rows from `asOf` on and `current` is everything else.
   *
   * **`asOf` is required**: an optional date would leave a silently wrong
   * default at the next call site. A screen passes {@link balanceAsOf}
   * (start of tomorrow — today's leave is taken); the accrual job passes the
   * start of the reset day, so the period it closes does not include leave
   * that belongs to the next one.
   */
  async balances(
    agencyId: string,
    policyId: Types.ObjectId,
    userIds: readonly Types.ObjectId[],
    asOf: Date,
  ): Promise<Map<string, LedgerBalance>> {
    if (!userIds.length) return new Map();
    const rows = await this.ledger.aggregate<{
      _id: Types.ObjectId;
      total: number;
      upcoming: number;
    }>([
      // `agencyId` first: it is the prefix of the index this read uses.
      { $match: { agencyId, policyId, userId: { $in: [...userIds] } } },
      {
        $group: {
          _id: '$userId',
          total: { $sum: '$hours' },
          upcoming: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $in: ['$kind', LEAVE_KINDS] },
                    { $gte: ['$effectiveAt', asOf] },
                  ],
                },
                '$hours',
                0,
              ],
            },
          },
        },
      },
    ]);
    return new Map(
      rows.map((row) => [
        row._id.toString(),
        {
          current: roundHours(row.total - row.upcoming),
          // `used` rows are negative; leave is reported as positive hours.
          upcoming: roundHours(-row.upcoming),
        },
      ]),
    );
  }

  /**
   * A person's leave in a policy, per day and per request, net of
   * reversals, inside `[from, before)` (either end open). What the request
   * service builds "other requested hours" per day and "used this period"
   * from. Days that net to zero — approved, then cancelled — are left out.
   */
  async leaveDays(
    agencyId: string,
    policyId: Types.ObjectId,
    userId: Types.ObjectId,
    range: { from?: Date; before?: Date } = {},
  ): Promise<LedgerLeaveDay[]> {
    const effectiveAt: Record<string, Date> = {};
    if (range.from) effectiveAt.$gte = range.from;
    if (range.before) effectiveAt.$lt = range.before;
    const rows = await this.ledger.aggregate<{
      _id: { effectiveAt: Date; requestId: Types.ObjectId | null };
      hours: number;
    }>([
      {
        $match: {
          agencyId,
          policyId,
          userId,
          kind: { $in: LEAVE_KINDS },
          ...(Object.keys(effectiveAt).length ? { effectiveAt } : {}),
        },
      },
      {
        $group: {
          _id: { effectiveAt: '$effectiveAt', requestId: '$source.id' },
          hours: { $sum: '$hours' },
        },
      },
      { $sort: { '_id.effectiveAt': 1 } },
    ]);
    return rows
      .map((row) => ({
        effectiveAt: row._id.effectiveAt,
        requestId: row._id.requestId ?? null,
        hours: roundHours(-row.hours),
      }))
      .filter((row) => row.hours !== 0);
  }

  /** Which of these people already have rows in the policy — their balance resumes. */
  async enrolledBefore(
    policyId: Types.ObjectId,
    userIds: readonly Types.ObjectId[],
  ): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const ids = await this.ledger.distinct('userId', {
      policyId,
      userId: { $in: [...userIds] },
    });
    return new Set(ids.map((id) => id.toString()));
  }
}
