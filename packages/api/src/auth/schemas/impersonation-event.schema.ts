import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ImpersonationEventDocument = HydratedDocument<ImpersonationEvent>;

/**
 * One row per session a platform admin minted as another user (PAC-70).
 *
 * **Deliberately not a `TenantRecord`.** Impersonation crosses the tenant
 * boundary by definition — the actor belongs to no agency — so the usual
 * `agencyId`-scoped base class would be describing the wrong thing. `agencyId`
 * here records *which tenant was entered*, and is nullable because a target
 * without an agency is possible in principle.
 *
 * **What is and is not recorded.** This captures the *issuing* of a session, not
 * what was subsequently done with it. Tokens are stateless and carry no session
 * id, so there is nothing to correlate individual later requests against; a
 * request-level trail would mean threading `impersonatedBy` into every write's
 * authorship, which is a much larger change and is not what PAC-70 asks for.
 * What this does answer — "who took a session as whom, and when" — is the
 * question an audit actually starts from. `JwtPayload.impersonatedBy` is the
 * in-flight half of the same story.
 *
 * Append-only. Nothing updates or deletes a row here; that is the point.
 */
@Schema({ timestamps: true, collection: 'impersonationEvents' })
export class ImpersonationEvent {
  /** The platform admin who took the session. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  actorUserId: Types.ObjectId;

  /** The user they became. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  targetUserId: Types.ObjectId;

  /** The tenant entered. Null only if the target somehow has no agency. */
  @Prop({ type: Types.ObjectId, ref: 'Agency', default: null })
  agencyId: Types.ObjectId | null;

  /**
   * When the token was minted. Distinct from `createdAt` on purpose: this is the
   * business fact being recorded, and it stays meaningful if the row is ever
   * copied or re-imported, whereas `createdAt` describes the document.
   */
  @Prop({ type: Date, required: true })
  issuedAt: Date;
}

export const ImpersonationEventSchema =
  SchemaFactory.createForClass(ImpersonationEvent);

/** "Who has been impersonated recently", the usual way an audit is read. */
ImpersonationEventSchema.index({ issuedAt: -1 });
