import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type {
  BugReportDetail,
  BugReportListItem,
  BugReportListResponse,
  BugReportScreenshot,
  BugReportStatus,
} from '@sfa/shared';
import { BUG_REPORT_STATUSES, bugReportSummary } from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import { StorageService } from '../storage/storage.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import type {
  ListBugReportsDto,
  UpdateBugReportDto,
} from './dto/bug-report.dto';
import {
  BugReport,
  BugReportDocument,
  BugReportScreenshotSubdoc,
} from './schemas/bug-report.schema';

/** Every status at zero — the base the aggregation's counts are merged onto. */
function emptyStatusCounts(): Record<BugReportStatus, number> {
  return BUG_REPORT_STATUSES.reduce(
    (acc, status) => ({ ...acc, [status]: 0 }),
    {} as Record<BugReportStatus, number>,
  );
}

/**
 * The Super Admin bug queue — read and triage.
 *
 * Cross-tenant by design: every report on the platform lands in one list. There
 * is no data-scope filtering anywhere in here and that is deliberate, not an
 * omission — `platform:bugs:read` is the boundary, and a platform operator sits
 * above the tenant one.
 */
@Injectable()
export class PlatformBugReportsService {
  constructor(
    @InjectModel(BugReport.name)
    private readonly bugReportModel: Model<BugReportDocument>,
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly storage: StorageService,
  ) {}

  async list(dto: ListBugReportsDto): Promise<BugReportListResponse> {
    const filter: FilterQuery<BugReportDocument> = {};
    if (dto.status?.length) filter.status = { $in: dto.status };
    if (dto.severity) filter.severity = dto.severity;
    if (dto.agencyId) filter.agencyId = new Types.ObjectId(dto.agencyId);
    if (dto.search) filter.$text = { $search: dto.search };

    const [docs, total, counts] = await Promise.all([
      this.bugReportModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(dto.skip)
        .limit(dto.limit)
        .lean(),
      this.bugReportModel.countDocuments(filter),
      /*
       * Counted over the **unfiltered** collection on purpose: these drive the
       * status chips, and a count that reflects the status filter would show
       * "New (12)" only while New was already selected — every other chip zero.
       */
      this.bugReportModel.aggregate<{ _id: BugReportStatus; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const agencyNames = await this.agencyNames(
      docs.map((doc) => doc.agencyId).filter((id) => id !== null),
    );

    const statusCounts = counts.reduce(
      (acc, row) => ({ ...acc, [row._id]: row.count }),
      emptyStatusCounts(),
    );

    const items: BugReportListItem[] = docs.map((doc) => ({
      id: doc._id.toString(),
      status: doc.status,
      severity: doc.severity,
      summary: bugReportSummary(doc.description),
      reporterName: doc.reporterName ?? null,
      reporterEmail: doc.reporterEmail,
      agencyId: doc.agencyId?.toString() ?? null,
      agencyName: doc.agencyId
        ? (agencyNames.get(doc.agencyId.toString()) ?? null)
        : null,
      screenshotCount: doc.screenshots.length,
      createdAt: toIso(doc.createdAt),
      updatedAt: toIso(doc.updatedAt),
    }));

    return { items, total, statusCounts };
  }

  async get(id: string): Promise<BugReportDetail> {
    const doc = await this.loadById(id);
    return this.toDetail(doc);
  }

  /**
   * Set the triage status and/or internal notes.
   *
   * `statusUpdatedBy`/`statusUpdatedAt` move only when the **status** actually
   * changes — editing a note is not a triage decision, and stamping it as one
   * would erase who last moved the report and when.
   */
  async update(
    id: string,
    dto: UpdateBugReportDto,
    operatorId: string,
  ): Promise<BugReportDetail> {
    const doc = await this.loadById(id);

    if (dto.status !== undefined && dto.status !== doc.status) {
      doc.status = dto.status;
      doc.statusUpdatedBy = new Types.ObjectId(operatorId);
      doc.statusUpdatedAt = new Date();
    }
    if (dto.internalNotes !== undefined) {
      // An empty string clears the note; `undefined` (omitted) leaves it.
      doc.internalNotes = dto.internalNotes || null;
    }

    await doc.save();
    return this.toDetail(doc);
  }

  private async loadById(id: string): Promise<BugReportDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Bug report not found.');
    }
    const doc = await this.bugReportModel.findById(id);
    if (!doc) {
      throw new NotFoundException('Bug report not found.');
    }
    return doc;
  }

  private async toDetail(doc: BugReportDocument): Promise<BugReportDetail> {
    const [agencyNames, statusUpdatedByName, screenshots] = await Promise.all([
      this.agencyNames(doc.agencyId ? [doc.agencyId] : []),
      this.userDisplayName(doc.statusUpdatedBy),
      this.signScreenshots(doc.screenshots),
    ]);

    return {
      id: doc._id.toString(),
      status: doc.status,
      severity: doc.severity,
      description: doc.description,
      reporterName: doc.reporterName ?? null,
      reporterEmail: doc.reporterEmail,
      agencyId: doc.agencyId?.toString() ?? null,
      agencyName: doc.agencyId
        ? (agencyNames.get(doc.agencyId.toString()) ?? null)
        : null,
      context: {
        url: doc.context?.url ?? null,
        route: doc.context?.route ?? null,
        userAgent: doc.context?.userAgent ?? null,
        viewport: doc.context?.viewport ?? null,
        theme: doc.context?.theme ?? null,
      },
      screenshots,
      screenshotUrlExpiresIn: this.storage.downloadUrlTtlSeconds,
      screenshotCount: doc.screenshots.length,
      internalNotes: doc.internalNotes ?? null,
      statusUpdatedAt: doc.statusUpdatedAt
        ? doc.statusUpdatedAt.toISOString()
        : null,
      statusUpdatedByName,
      createdAt: toIso(doc.createdAt),
      updatedAt: toIso(doc.updatedAt),
    };
  }

  /**
   * Presign every screenshot as an **inline** GET so the detail page can render
   * them straight into `<img>` tags.
   *
   * `contentType` is overridden explicitly for the same reason quote documents
   * do it: an image stored as `application/octet-stream` downloads instead of
   * rendering, whatever the disposition says. The storage key itself never
   * reaches the client — only the signed URL and the subdocument id.
   */
  private async signScreenshots(
    screenshots: BugReportScreenshotSubdoc[],
  ): Promise<BugReportScreenshot[]> {
    return Promise.all(
      screenshots.map(async (shot) => ({
        id: shot._id?.toString() ?? shot.key,
        filename: shot.filename,
        contentType: shot.contentType,
        size: shot.size,
        url: await this.storage.createPresignedDownload(shot.key, {
          disposition: 'inline',
          filename: shot.filename,
          contentType: shot.contentType,
        }),
      })),
    );
  }

  /** Agency id -> name, for the rows that have one. */
  private async agencyNames(
    ids: Types.ObjectId[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const unique = [...new Set(ids.map((id) => id.toString()))];
    const agencies = await this.agencyModel
      .find({ _id: { $in: unique.map((id) => new Types.ObjectId(id)) } })
      .select('name')
      .lean();
    return new Map(
      agencies.map((agency) => [agency._id.toString(), agency.name]),
    );
  }

  private async userDisplayName(
    id: Types.ObjectId | null,
  ): Promise<string | null> {
    if (!id) return null;
    const user = await this.userModel
      .findById(id)
      .select('email firstName lastName')
      .lean();
    if (!user) return null;
    const name = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return name || user.email;
  }
}

/**
 * `createdAt`/`updatedAt` are typed optional on the schema class (the
 * `timestamps` option owns them at runtime), so every read has to answer for
 * the case Mongoose will never actually produce.
 */
function toIso(value: Date | undefined): string {
  return (value ?? new Date()).toISOString();
}
