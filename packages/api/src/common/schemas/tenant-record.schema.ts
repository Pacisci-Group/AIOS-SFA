import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, IndexOptions, Types } from 'mongoose';

export type TenantDocument = HydratedDocument<TenantRecord>;

@Schema({ timestamps: true })
export class TenantRecord {
  @Prop({ required: true, index: true })
  agencyId: string;

  @Prop({ required: true, index: true })
  branchId: string;

  @Prop({ sparse: true, index: true })
  legacySmartSuiteId?: string;

  /**
   * Written by `timestamps: true` above, declared here so it is *typed*.
   *
   * Mongoose adds both fields to every document at runtime but `@nestjs/mongoose`
   * infers the document type from the class, so without these a read of
   * `record.createdAt` is an implicit `any` — it compiles, then trips
   * `no-unsafe-argument` the moment it is passed anywhere. Declared without
   * `@Prop` on purpose: the schema option owns the fields, and re-declaring them
   * as props would add a second, conflicting definition.
   */
  createdAt?: Date;
  updatedAt?: Date;

  /*
   * The user counterparts to the two timestamps above (PAC-72).
   *
   * Written by `authorshipPlugin`, which is registered connection-wide and
   * keys off these very paths — so declaring them here is what opts a
   * collection in. Every `TenantRecord` descendant gets them at once.
   *
   * ⚠ **Nullable, and never backfilled.** Migration-, seed- and worker-written
   * records have no acting user; `null` is the honest answer and reads as
   * "system". Do not mint a placeholder user id to fill the column, and do not
   * retro-assign an author to historical rows — nobody knows who wrote them.
   *
   * Unindexed on purpose. Nothing queries by author yet, and the two dead
   * `producerId` indexes dropped from `activities` are the standing reminder
   * that an index for a predicate nobody uses is pure write cost. Add one with
   * the query that needs it.
   */

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;
}

export const TenantRecordSchema = SchemaFactory.createForClass(TenantRecord);
TenantRecordSchema.index({ agencyId: 1, branchId: 1, createdAt: -1 });

/**
 * Options for the per-agency `{ agencyId, legacySmartSuiteId }` migration-dedupe
 * index that every tenant collection declares.
 *
 * Must be a partial filter, NOT `sparse: true`. MongoDB only omits a document
 * from a *compound* sparse index when **every** indexed field is missing —
 * `agencyId` is always present, so records written by the app (which carry no
 * legacy id) are indexed as `(agencyId, null)` and the second such record in an
 * agency fails with E11000. Filtering on the field's type indexes only the
 * migrated records the dedupe key actually exists for.
 */
export const LEGACY_DEDUPE_INDEX_OPTIONS = {
  unique: true,
  partialFilterExpression: { legacySmartSuiteId: { $type: 'string' } },
} satisfies IndexOptions;
