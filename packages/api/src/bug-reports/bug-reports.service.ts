import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AccessContext, BugReportReceipt } from '@sfa/shared';
import { MAX_BUG_SCREENSHOTS } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  StorageService,
  type PresignedUpload,
} from '../storage/storage.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import type {
  CreateBugReportDto,
  PresignBugScreenshotDto,
} from './dto/bug-report.dto';
import { BugReport, BugReportDocument } from './schemas/bug-report.schema';

/**
 * The storage namespace screenshots are filed under, per reporter.
 *
 * Scoped to the **user**, not just the agency, so `assertKeyOwnership` pins a
 * submitted key to the person who was issued it. Without the user segment, any
 * member of an agency could hand back a colleague's key and attach their
 * screenshot to their own report.
 */
function screenshotPurpose(userId: string): string {
  return `bug-reports/${userId}`;
}

/**
 * The key namespace's agency segment.
 *
 * A platform operator has no agency, and `buildObjectKey` requires *something*
 * for that slot. `platform` is a literal that cannot collide with an ObjectId,
 * so their uploads get their own prefix rather than sharing a tenant's.
 */
function keyAgencySegment(access: AccessContext): string {
  return access.agencyId ?? 'platform';
}

/**
 * Filing a bug report. The reporter half of the feature.
 *
 * ## No permission, on purpose
 *
 * Nothing in here checks a permission, and the controller declares none. A user
 * who cannot report a bug reports it to nobody — and the users most likely to
 * hit one are the ones whose page just 403'd. Reading the queue is what is
 * gated (`platform:bugs:read`); writing to it is open to any authenticated
 * caller, with the rate limit on the controller as the abuse bound.
 */
@Injectable()
export class BugReportsService {
  constructor(
    @InjectModel(BugReport.name)
    private readonly bugReportModel: Model<BugReportDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly storage: StorageService,
  ) {}

  /** Presigned PUT for one screenshot. The bytes never pass through the API. */
  async presignScreenshot(
    access: AccessContext,
    dto: PresignBugScreenshotDto,
  ): Promise<PresignedUpload> {
    const key = this.storage.buildObjectKey({
      agencyId: keyAgencySegment(access),
      purpose: screenshotPurpose(access.userId),
      filename: dto.filename,
    });
    return this.storage.createPresignedUpload(key, dto.contentType);
  }

  /**
   * Record a report.
   *
   * The reporter's email and name are read from their user document rather than
   * taken from the request: they are what the queue identifies a report by, and
   * a client-supplied identity on a cross-tenant queue is an invitation to
   * file a report as somebody else.
   */
  async create(
    access: AccessContext,
    dto: CreateBugReportDto,
  ): Promise<BugReportReceipt> {
    const user = await this.userModel
      .findById(access.userId)
      .select('email firstName lastName')
      .lean();
    if (!user) {
      // Unreachable in practice — `AccessContextGuard` has already resolved
      // this user — but the alternative is writing a report with no author.
      throw new NotFoundException('Reporter not found.');
    }

    const screenshots = await this.verifyScreenshots(access, dto);

    const name = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();

    const created = await this.bugReportModel.create({
      reportedBy: new Types.ObjectId(access.userId),
      reporterEmail: user.email,
      reporterName: name || null,
      agencyId: access.agencyId ? new Types.ObjectId(access.agencyId) : null,
      branchId: access.branchId ? new Types.ObjectId(access.branchId) : null,
      description: dto.description,
      severity: dto.severity,
      screenshots,
      context: dto.context,
      status: 'new',
    });

    return {
      id: created._id.toString(),
      createdAt: (created.createdAt ?? new Date()).toISOString(),
    };
  }

  /**
   * Re-check every submitted key against storage before it reaches a document.
   *
   * Two separate checks, and both matter. `assertKeyOwnership` rejects a key
   * this user was never issued — a client hands back whatever key it was given,
   * so without it, it could hand back *any* key it knew of. `statObject` is the
   * only server-side evidence of what was actually uploaded: a presigned PUT
   * signs only the content type, so the declared size is the client's claim
   * about a file the API has never seen.
   *
   * A key that presigned but never completed its upload is dropped rather than
   * failing the whole submission — losing one screenshot is a much better
   * outcome than losing the report it was attached to.
   */
  private async verifyScreenshots(
    access: AccessContext,
    dto: CreateBugReportDto,
  ): Promise<
    Array<{
      key: string;
      filename: string;
      contentType: string;
      size: number;
      uploadedAt: Date;
    }>
  > {
    if (dto.screenshots.length === 0) return [];
    if (dto.screenshots.length > MAX_BUG_SCREENSHOTS) {
      throw new BadRequestException(
        `At most ${MAX_BUG_SCREENSHOTS} screenshots per report.`,
      );
    }

    const owner = {
      agencyId: keyAgencySegment(access),
      purpose: screenshotPurpose(access.userId),
    };

    const verified = await Promise.all(
      dto.screenshots.map(async (screenshot) => {
        this.storage.assertKeyOwnership(screenshot.key, owner);
        const stored = await this.storage.statObject(screenshot.key);
        if (!stored) return null;
        return {
          key: screenshot.key,
          filename: screenshot.filename,
          // From storage, never from the request — see the docblock.
          contentType: stored.contentType ?? screenshot.contentType,
          size: stored.size,
          uploadedAt: new Date(),
        };
      }),
    );

    return verified.filter((item) => item !== null);
  }
}
