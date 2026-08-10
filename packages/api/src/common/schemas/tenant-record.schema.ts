import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, IndexOptions } from 'mongoose';

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
