import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BranchDocument = HydratedDocument<Branch>;

/**
 * Where the branch is, in the one structured shape the app agrees on
 * (`StructuredAddress` in `@sfa/shared`).
 *
 * Optional, and every reader must treat it that way: branches created before
 * PAC-69 — the migrated agency's "Main", the demo seed's, every test fixture —
 * have none, and there is nowhere to backfill one from. It is collected at
 * onboarding because an operator standing up a new agency knows it, not because
 * anything depends on it yet.
 */
@Schema({ _id: false })
export class BranchAddress {
  @Prop({ trim: true })
  street?: string;

  @Prop({ trim: true })
  city?: string;

  @Prop({ trim: true })
  state?: string;

  @Prop({ trim: true })
  zip?: string;
}
export const BranchAddressSchema = SchemaFactory.createForClass(BranchAddress);

@Schema({ timestamps: true, collection: 'branches' })
export class Branch {
  @Prop({ type: Types.ObjectId, ref: 'Agency', required: true, index: true })
  agencyId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ default: false })
  isDefault: boolean;

  /** See {@link BranchAddress} — absent on every branch predating PAC-69. */
  @Prop({ type: BranchAddressSchema })
  address?: BranchAddress;

  @Prop({ type: Object, default: {} })
  settings: Record<string, unknown>;
}

export const BranchSchema = SchemaFactory.createForClass(Branch);
BranchSchema.index({ agencyId: 1, slug: 1 }, { unique: true });
