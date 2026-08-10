import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AccessContext, DataScope, ShareLinkRow } from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { TenantContextResolver } from '../common/tenancy/tenant-context.resolver';
import { PUBLIC_FORM_BASE_URL } from '../config/public-form.config';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { ShareLink, ShareLinkDocument } from './schemas/share-link.schema';
import { generateShareLinkToken } from './share-link-token';

/** Retries on the (vanishingly unlikely) token collision. */
const TOKEN_INSERT_ATTEMPTS = 3;
const DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  );
}

@Injectable()
export class ShareLinksService {
  private readonly logger = new Logger(ShareLinksService.name);

  constructor(
    @InjectModel(ShareLink.name)
    private readonly shareLinkModel: Model<ShareLinkDocument>,
    private readonly tenancy: TenantContextResolver,
  ) {}

  /** Mint a link for the caller. Never for anyone else — see the DTO. */
  async create(
    access: AccessContext,
    branchId: string | null,
    dto: CreateShareLinkDto,
  ): Promise<ShareLinkRow> {
    const tenant = await this.tenancy.resolve(access, branchId);
    const producerId = new Types.ObjectId(access.userId);

    for (let attempt = 1; attempt <= TOKEN_INSERT_ATTEMPTS; attempt++) {
      try {
        const created = await this.shareLinkModel.create({
          agencyId: tenant.agencyId,
          branchId: tenant.branchId,
          token: generateShareLinkToken(),
          producerId,
          label: dto.label,
          isActive: true,
          submissionCount: 0,
          createdById: producerId,
        });
        return this.toRow(created);
      } catch (error) {
        if (isDuplicateKeyError(error) && attempt < TOKEN_INSERT_ATTEMPTS) {
          this.logger.warn(
            `Share-link token collision on attempt ${attempt}; regenerating.`,
          );
          continue;
        }
        throw error;
      }
    }

    // Unreachable: the loop either returns or rethrows.
    throw new Error('Failed to generate a share link token.');
  }

  /** The caller's own links. `own` scope can never widen this. */
  async list(access: AccessContext): Promise<{ items: ShareLinkRow[] }> {
    const filter: FilterQuery<ShareLinkDocument> = {
      agencyId: access.agencyId,
    };

    // A producer sees only their own. Broader scopes still default to the
    // caller's links — listing every producer's links is a management view
    // nobody has asked for, and each row exposes a working credential.
    filter.producerId = new Types.ObjectId(access.userId);

    const records = await this.shareLinkModel
      .find(filter)
      .sort({ createdAt: -1 });

    return { items: records.map((record) => this.toRow(record)) };
  }

  /**
   * Deactivate a link — the kill switch for one that has leaked.
   *
   * Idempotent: revoking an already-revoked link returns the original
   * `revokedAt` rather than moving it, mirroring `DealAuditsService.resolveItem`.
   */
  async revoke(
    access: AccessContext,
    branchId: string | null,
    id: string,
  ): Promise<ShareLinkRow> {
    const link = await this.loadOwnedLink(access, branchId, id);
    if (!link.isActive) return this.toRow(link);

    link.isActive = false;
    link.revokedAt = new Date();
    link.revokedById = new Types.ObjectId(access.userId);
    await link.save();

    return this.toRow(link);
  }

  /**
   * Load a link inside the caller's agency and enforce data scope — the same
   * shape as `DealAuditsService.loadOwnedItem`.
   */
  private async loadOwnedLink(
    access: AccessContext,
    branchId: string | null,
    id: string,
  ): Promise<ShareLinkDocument> {
    // A malformed id is a miss, not a 500.
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Share link not found.');
    }

    const link = await this.shareLinkModel.findOne({
      _id: new Types.ObjectId(id),
      agencyId: access.agencyId,
    });
    if (!link) throw new NotFoundException('Share link not found.');

    // Scope is checked on the loaded document. A 404 rather than a 403: whether
    // another producer's link exists is not the caller's business.
    if (
      access.dataScope === DataScope.Own &&
      link.producerId.toString() !== access.userId
    ) {
      throw new NotFoundException('Share link not found.');
    }
    if (
      access.dataScope === DataScope.Branch &&
      branchId &&
      link.branchId !== branchId
    ) {
      throw new NotFoundException('Share link not found.');
    }

    return link;
  }

  private toRow(link: ShareLinkDocument): ShareLinkRow {
    return {
      id: link._id.toString(),
      token: link.token,
      url: `${PUBLIC_FORM_BASE_URL}/f/lead/${link.token}`,
      label: link.label ?? null,
      isActive: link.isActive,
      submissionCount: link.submissionCount,
      lastSubmissionAt: link.lastSubmissionAt?.toISOString() ?? null,
      createdAt: link.get('createdAt')?.toISOString() ?? '',
      revokedAt: link.revokedAt?.toISOString() ?? null,
    };
  }
}
