import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CarrierDocument = HydratedDocument<Carrier>;

/**
 * A selectable insurance carrier (PAC-56 #19).
 *
 * ## Why this does not extend `TenantRecord`
 *
 * `TenantRecord.agencyId` and `.branchId` are both `required: true`, and a
 * platform-seeded global carrier has neither. `Agency` is the existing
 * precedent for a plain, non-tenant-scoped collection.
 *
 * ## `agencyId: null` is a value, not an absence
 *
 * `null` means "platform global — every agency sees it"; a string means "this
 * agency added it". Stored explicitly (`default: null`) rather than left off the
 * document so `find({ agencyId: null })` is unambiguous, and so the unique index
 * below has a real key to work with. That also means this unique index, unlike
 * every other one in the codebase, needs **no** `partialFilterExpression`: Mongo
 * indexes `null` as a value, so the global Allstate and an agency's own Allstate
 * are distinct keys rather than a collision.
 *
 * ## Future admin CRUD (deliberately not built)
 *
 * PAC-56 #19 seeds globals and exposes a read. `agencyId`, `active` and
 * `displayOrder` are here so the two write surfaces drop in as controllers with
 * no schema change: super-admin CRUD at `platform/carriers` under `platform:*`
 * writing `agencyId: null`, and agency-owner CRUD under `agency:*` writing its
 * own id. Do not re-litigate the shape when building those — build the
 * controllers.
 */
@Schema({ timestamps: true, collection: 'carriers' })
export class Carrier {
  /** `null` = platform-seeded global. A string = that agency's own addition. */
  @Prop({ type: String, default: null, index: true })
  agencyId: string | null;

  /** The display name. This is what gets stored on `Policy.carrier`. */
  @Prop({ required: true, trim: true })
  name: string;

  /** Dedupe key — see `carrierSlug`. Server-side only, never sent to the web. */
  @Prop({ required: true, trim: true, index: true })
  slug: string;

  @Prop({ default: true, index: true })
  active: boolean;

  /**
   * Regex **source**, stored unanchored and tested against the *normalized*
   * policy-number key. Absent = this carrier imposes no format.
   *
   * ⚠ Only seed a pattern you are actually confident in. There is no admin UI
   * yet, so a wrong pattern is fixable only by a deploy — and it fails closed,
   * blocking a real sale. `maxlength` is the ReDoS floor until write-time
   * validation arrives with the admin CRUD.
   */
  @Prop({ trim: true, maxlength: 200 })
  policyNumberPattern?: string;

  /** Plain-language statement of the rule, quoted back when a number rejects. */
  @Prop({ trim: true, maxlength: 200 })
  policyNumberHint?: string;

  /** Ascending. Ties break on `name`. Lets the agency's own carrier sit first. */
  @Prop()
  displayOrder?: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CarrierSchema = SchemaFactory.createForClass(Carrier);

/** One row per name per scope; see the `agencyId: null` note on the class. */
CarrierSchema.index({ agencyId: 1, slug: 1 }, { unique: true });

/** Backs the list read: globals ∪ one agency, active only, in display order. */
CarrierSchema.index({ agencyId: 1, active: 1, displayOrder: 1, name: 1 });
