import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type {
  MailerZipMarket as MailerZipMarketDto,
  MailerZipMarketListResponse,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import type { ZipMarketRow } from '../common/mailers/zip-markets';
import type {
  ListZipMarketsDto,
  UpsertZipMarketsDto,
} from './dto/mailer-zip-market.dto';
import {
  MailerZipMarket,
  type MailerZipMarketDocument,
} from './schemas/mailer-zip-market.schema';

/**
 * The ZIP → market table (PAC-71).
 *
 * Replaces the Google Sheet ApexReports reads, and it is editable data rather
 * than a constant: the market decides the local-presence phone number on the
 * mail piece, and new ZIPs turn up in every campaign. The preview surfaces
 * unmapped ZIPs so the operator resolves them inline, and those answers are
 * written back here — Apex's own resolver flow, minus the spreadsheet.
 *
 * ## Reads happen in the worker, not here
 *
 * The preview and commit jobs fold the table themselves, through
 * `buildZipMarketTable` in `common/`. They cannot inject this service (the
 * worker import boundary forbids feature services), and duplicating the fold
 * would let a preview resolve a ZIP differently from the commit that follows
 * it. This service owns the *write* side and the panel's list.
 */
@Injectable()
export class MailerZipMarketsService {
  constructor(
    @InjectModel(MailerZipMarket.name)
    private readonly model: Model<MailerZipMarketDocument>,
  ) {}

  async list(query: ListZipMarketsDto): Promise<MailerZipMarketListResponse> {
    const filter: Record<string, unknown> = {
      // ⚠ `null` is a *value* here, not an absence — the `Carrier` pattern — so
      // an equality match is exact rather than also catching missing fields.
      agencyId: query.agencyId ?? null,
    };
    if (query.q) {
      const escaped = query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        // Anchored on the ZIP so the `{agencyId, zip5}` index can serve it;
        // the market match is a scan over what that already narrowed.
        { zip5: { $regex: `^${escaped}` } },
        { market: { $regex: escaped, $options: 'i' } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.model.countDocuments(filter),
      this.model
        .find(filter)
        .sort({ zip5: 1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean(),
    ]);

    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      items: rows.map((row) => this.toDto(row)),
    };
  }

  /**
   * Create or correct mappings.
   *
   * `$set` on the market, unlike the seed's `$setOnInsert`: this **is** the
   * correction path. `source` records who decided — `manual` from the table
   * page, `preview` from an operator resolving an unmatched ZIP mid-run — so a
   * later re-seed can keep leaving human answers alone.
   */
  async upsertMany(
    dto: UpsertZipMarketsDto,
    updatedBy: string | null,
    source: 'manual' | 'preview' = 'manual',
  ): Promise<{ upserted: number; updated: number }> {
    const res = await this.model.bulkWrite(
      dto.entries.map((entry) => ({
        updateOne: {
          filter: { agencyId: entry.agencyId ?? null, zip5: entry.zip5 },
          update: {
            $set: {
              market: entry.market,
              source,
              updatedBy: updatedBy ? new Types.ObjectId(updatedBy) : null,
            },
          },
          upsert: true,
        },
      })),
      // A pasted block that repeats a ZIP would otherwise abort the rest of the
      // batch on the unique index; unordered lets the good rows land.
      { ordered: false },
    );
    return {
      upserted: res.upsertedCount ?? 0,
      updated: res.modifiedCount ?? 0,
    };
  }

  async remove(id: string): Promise<{ deleted: true }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('ZIP mapping not found.');
    }
    const res = await this.model.deleteOne({ _id: id });
    if (res.deletedCount === 0) {
      throw new NotFoundException('ZIP mapping not found.');
    }
    return { deleted: true };
  }

  /** Every row in one scope, in the shape `buildZipMarketTable` folds. */
  async rowsFor(agencyId: string | null = null): Promise<ZipMarketRow[]> {
    const rows = await this.model
      .find({ agencyId })
      .select({ agencyId: 1, zip5: 1, market: 1 })
      .lean();
    return rows.map((row) => ({
      agencyId: row.agencyId ?? null,
      zip5: row.zip5,
      market: row.market,
    }));
  }

  private toDto(row: {
    _id: Types.ObjectId;
    agencyId?: string | null;
    zip5: string;
    market: string;
    source: MailerZipMarketDto['source'];
    updatedAt?: Date;
  }): MailerZipMarketDto {
    return {
      id: row._id.toString(),
      agencyId: row.agencyId ?? null,
      zip5: row.zip5,
      market: row.market,
      source: row.source,
      updatedAt: (row.updatedAt ?? new Date()).toISOString(),
    };
  }
}
