import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type ShareLinkDocument = HydratedDocument<ShareLink>;

/**
 * A producer's public lead-intake link (PAC-37).
 *
 * The token is the *only* thing that appears in the URL (`/f/lead/{token}`).
 * The alternative — putting the producer's ObjectId in a query param — fails
 * three ways: an ObjectId is guessable and swappable, so anyone could reroute
 * leads to a different producer; it leaks internal identifiers; and a leaked
 * link could never be revoked. The indirection fixes all three and lets us
 * attribute submissions per link.
 *
 * Scope note: this record deliberately holds **no** lead source, partner
 * attribution or branding. Per-use-case configured links are PAC-53; all of
 * those are additive optional fields on this shape, so nothing here needs
 * reshaping to accept them later.
 */
@Schema({ timestamps: true, collection: 'shareLinks' })
export class ShareLink extends TenantRecord {
  /**
   * 32 random bytes, base64url (43 chars).
   *
   * Unique **globally**, not per agency: the public lookup is `findOne({ token })`
   * with no tenant context, so a cross-tenant collision would be a tenancy
   * breach rather than a duplicate-key error. Plain `unique` is correct here
   * because the field is required — the partial-filter rule applies to the
   * *optional* fields elsewhere in this codebase.
   *
   * Stored in plaintext: `GET /leads/share-links` has to return it so a producer
   * can re-copy their URL, which rules out hashing. Accepted risk — with no
   * expiry, a leaked link stays live until revoked, and revocation is the
   * containment mechanism.
   */
  @Prop({ required: true, unique: true, index: true })
  token: string;

  /** Every lead submitted through this link is assigned to this user. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  producerId: Types.ObjectId;

  /**
   * A producer's own note so they can tell their links apart ("Referrals from
   * Dave at First National"). Display only — it has no effect on created leads.
   */
  @Prop({ trim: true })
  label?: string;

  @Prop({ default: true, index: true })
  isActive: boolean;

  /** Counts *new* leads only — a replayed submission must not inflate it. */
  @Prop({ default: 0 })
  submissionCount: number;

  @Prop({ type: Date })
  lastSubmissionAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdById: Types.ObjectId;

  @Prop({ type: Date })
  revokedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  revokedById?: Types.ObjectId;
}

export const ShareLinkSchema = SchemaFactory.createForClass(ShareLink);
ShareLinkSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
/** `GET /leads/share-links` — the caller's own links, newest first. */
ShareLinkSchema.index({ agencyId: 1, producerId: 1, createdAt: -1 });
