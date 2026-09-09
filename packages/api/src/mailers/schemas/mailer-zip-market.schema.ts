import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { MailerZipMarket as MailerZipMarketView } from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type MailerZipMarketDocument = HydratedDocument<MailerZipMarket>;

/**
 * One ZIP → market mapping (PAC-71).
 *
 * Replaces the Google Sheet ApexReports reads (`1EubGmhG4s…`). The transform
 * uses it to write `Right_Name` (the market) and, from that, the local-presence
 * `agencyphon` — so an unmapped ZIP silently mails the default market's phone
 * number, which is why the preview surfaces unmatched ZIPs for inline
 * resolution and writes the answers back here.
 *
 * ## `agencyId: null` is a value, not an absence
 *
 * The table is **platform-global in this ticket**: a campaign can serve many
 * agencies, so during a preview no single agency owns the resolution. The
 * column exists so per-agency overrides are additive later with no migration —
 * the `Carrier` pattern, where `null` is stored explicitly so
 * `find({ agencyId: null })` is unambiguous and the unique index has a real key
 * to work with. Nothing writes a non-null value yet.
 */
@Schema({ timestamps: true, collection: 'mailerZipMarkets' })
export class MailerZipMarket {
  /** `null` = platform-global. A string would be that agency's own override. */
  @Prop({ type: String, default: null, index: true })
  agencyId: string | null;

  /**
   * The 5-digit ZIP, validated.
   *
   * The seed source carries a four-digit typo (`4031`, which should be
   * `74031` — the row for it exists too), and a short key would never match a
   * real address and would sit in the table looking like a mapping. Rejected at
   * the boundary rather than stored and silently useless.
   */
  @Prop({
    required: true,
    trim: true,
    match: [/^\d{5}$/, 'zip5 must be exactly 5 digits'],
  })
  zip5: string;

  /** `Tulsa`, `Oklahoma City`, `580 Group` — free text, as the source has it. */
  @Prop({ required: true, trim: true })
  market: string;

  /**
   * Where the row came from.
   *
   * `seed` rows are written with `$setOnInsert` so a later correction is never
   * overwritten by a re-seed; `preview` is an operator resolving an unmatched
   * ZIP mid-run; `manual` is the ZIP-table page.
   */
  @Prop({
    required: true,
    type: String,
    default: 'manual',
    enum: ['seed', 'preview', 'manual'],
  })
  source: MailerZipMarketView['source'];

  /** Null for seeded rows — nobody typed those. */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const MailerZipMarketSchema =
  SchemaFactory.createForClass(MailerZipMarket);

/**
 * One row per ZIP per scope.
 *
 * Deliberately **not** partial: `agencyId: null` is a value here (see the class
 * note), so Mongo indexes it as one and the global row for `74133` and an
 * agency's own override of `74133` are distinct keys rather than a collision.
 * Same reasoning as `Carrier`'s `{ agencyId, slug }`.
 */
MailerZipMarketSchema.index({ agencyId: 1, zip5: 1 }, { unique: true });
