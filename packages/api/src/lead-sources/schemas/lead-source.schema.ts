import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type LeadSourceDocument = HydratedDocument<LeadSource>;

/**
 * Where a lead came from (PAC-135).
 *
 * The `Carrier` pattern, for the same reasons — read that class note first. In
 * short: this cannot extend `TenantRecord` because a platform row has no agency
 * or branch, and `agencyId: null` is stored as a **value** so
 * `find({ agencyId: null })` is unambiguous and the unique index needs no
 * `partialFilterExpression`.
 *
 * ## Archive, never delete
 *
 * Leads and deals reference a row by id, and a sale from two years ago still has
 * to say where it came from. `active: false` takes a source out of the pickers;
 * the row stays so history keeps resolving.
 *
 * ## `slug` is the identity code relies on
 *
 * `name` is what people read and may one day rename. Anything that has to find a
 * particular source — the mailer flow stamping "Mailer" on every lead it logs —
 * goes through `slug`, which a rename does not touch.
 *
 * ## Curation (deliberately not built)
 *
 * Seeded only. Super-admin CRUD over the `agencyId: null` rows and agency-owner
 * CRUD over an agency's own rows drop in as controllers with no schema change.
 */
@Schema({ timestamps: true, collection: 'leadSources' })
export class LeadSource {
  /** `null` = platform source, every agency sees it. A string = that agency's. */
  @Prop({ type: String, default: null, index: true })
  agencyId: string | null;

  @Prop({ required: true, trim: true })
  name: string;

  /** Dedupe + lookup key — see `leadSourceSlug`. */
  @Prop({ required: true, trim: true, index: true })
  slug: string;

  @Prop({ default: true, index: true })
  active: boolean;

  /**
   * Ascending, ties broken by `name`. Absent on an agency's own rows, which sort
   * as `LEAD_SOURCE_DEFAULT_ORDER` — resolved in `LeadSourcesService.list`, not
   * by Mongo, which orders a missing field before every number.
   */
  @Prop()
  displayOrder?: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const LeadSourceSchema = SchemaFactory.createForClass(LeadSource);

/** One row per name per scope; see the `agencyId: null` note on `Carrier`. */
LeadSourceSchema.index({ agencyId: 1, slug: 1 }, { unique: true });

/** Backs the list read: platform ∪ one agency, active only. Sorted in memory. */
LeadSourceSchema.index({ agencyId: 1, active: 1 });
