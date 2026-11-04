import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  roundHours,
  type LeaveLedgerKind,
  type LeaveLedgerReason,
  type LeaveLedgerSourceKind,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  LeaveLedger,
  type LeaveLedgerDocument,
} from '../../hr/schemas/leave-ledger.schema';

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
}

/**
 * The one writer and reader of `leaveLedger` (PAC-174). Lives in `common/`
 * so the accrual job in the worker and the HR policies service share it.
 *
 * Append-only: there is no update path here and there must never be one.
 * PAC-165 adds the request-driven writers (`used`, `reversal`,
 * `manual_adjustment`) as methods on this class, not a second service.
 */
@Injectable()
export class LeaveLedgerService {
  constructor(
    @InjectModel(LeaveLedger.name)
    private readonly ledger: Model<LeaveLedgerDocument>,
  ) {}

  /** Hand-written rows: a starting balance, a removal. */
  async post(rows: NewLedgerRow[]): Promise<void> {
    if (!rows.length) return;
    await this.ledger.insertMany(
      rows.map((row) => ({
        ...row,
        hours: roundHours(row.hours),
        periodKey: row.periodKey ?? null,
        reason: row.reason ?? null,
        reversesId: row.reversesId ?? null,
      })),
    );
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
   * Each person's balance in the policy: the sum of their rows, two
   * decimals. Someone with no rows is absent from the map (read as 0 by a
   * caller that knows they are enrolled).
   */
  async balances(
    policyId: Types.ObjectId,
    userIds: readonly Types.ObjectId[],
  ): Promise<Map<string, number>> {
    if (!userIds.length) return new Map();
    const rows = await this.ledger.aggregate<{
      _id: Types.ObjectId;
      hours: number;
    }>([
      { $match: { policyId, userId: { $in: [...userIds] } } },
      { $group: { _id: '$userId', hours: { $sum: '$hours' } } },
    ]);
    return new Map(
      rows.map((row) => [row._id.toString(), roundHours(row.hours)]),
    );
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
