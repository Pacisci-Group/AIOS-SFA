import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BranchDocument = HydratedDocument<Branch>;

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

  @Prop({ type: Object, default: {} })
  settings: Record<string, unknown>;
}

export const BranchSchema = SchemaFactory.createForClass(Branch);
BranchSchema.index({ agencyId: 1, slug: 1 }, { unique: true });
