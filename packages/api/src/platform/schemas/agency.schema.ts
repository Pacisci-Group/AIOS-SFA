import type { ModuleEntitlements } from '@sfa/shared';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AgencyDocument = HydratedDocument<Agency>;

@Schema({ timestamps: true, collection: 'agencies' })
export class Agency {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ default: 'active', enum: ['active', 'inactive', 'suspended'] })
  status: string;

  @Prop({ type: Object, default: {} })
  modules: ModuleEntitlements;

  @Prop({ type: Object, default: {} })
  settings: Record<string, unknown>;

  /**
   * The three-letter ticker that prefixes this agency's mailer `FileName`
   * (`SFA-20P` -> `SFA`). Uppercase (PAC-73).
   *
   * This is how the BigQuery mailer backfill attributes a row to a tenant —
   * nothing in that table carries an agency reference we own. Rows whose ticker
   * matches no `Agency` are skipped and counted, never guessed: filing one
   * agency's prospects under another is worse than leaving them out, and a
   * later re-run picks them up once the agency exists.
   */
  @Prop({ trim: true, uppercase: true })
  ticker?: string;

  /**
   * The Allstate agency id as printed in a mailer file's `agencyid` column
   * (`A0B9049`). Uppercase (PAC-73).
   *
   * ⚠ Distinct from {@link ticker} and used for a different job: this is only
   * ever **cross-checked** against an upload so the operator is warned when the
   * file's own agency disagrees with the one they picked. It never selects an
   * agency. Keeping it here is what makes that check a data lookup rather than
   * a hard-coded map.
   */
  @Prop({ trim: true, uppercase: true })
  allstateAgencyId?: string;
}

export const AgencySchema = SchemaFactory.createForClass(Agency);

/**
 * One agency per ticker.
 *
 * A partial filter rather than `sparse` so the many agencies with no ticker do
 * not all collide on `null` — the same trap written up on
 * `LEGACY_DEDUPE_INDEX_OPTIONS`. (`sparse` would in fact work here because the
 * index is single-field, but every other unique index in this codebase is a
 * partial filter and a reader should not have to re-derive why this one is
 * different.)
 */
AgencySchema.index(
  { ticker: 1 },
  { unique: true, partialFilterExpression: { ticker: { $type: 'string' } } },
);
