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
}

export const AgencySchema = SchemaFactory.createForClass(Agency);
