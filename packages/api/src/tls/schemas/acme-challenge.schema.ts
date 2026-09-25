import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AcmeChallengeDocument = HydratedDocument<AcmeChallenge>;

/**
 * One in-flight ACME `http-01` challenge.
 *
 * ## Why this is a collection and not a variable
 * This is the single detail that decides whether the whole design survives more
 * than one node, so it is worth being explicit about.
 *
 * An `http-01` challenge works like this: we tell Let's Encrypt we want a
 * certificate for `texasholdings.com`, and it responds with a token. It then
 * makes a plain HTTP request to `http://texasholdings.com/.well-known/acme-
 * challenge/<token>` and expects the matching key authorization back.
 *
 * **That request goes through the load balancer like any other**, so it arrives
 * at whichever node the balancer picks — which is almost never the node whose
 * worker placed the order. Holding the token in process memory, or on a node's
 * disk, means the validation lands on a node that has never heard of it and
 * answers 404. Every issuance then fails, intermittently, at a rate that looks
 * exactly like flaky DNS.
 *
 * In Mongo, any node can answer. The naive single-node design and the correct
 * one differ only by this collection.
 *
 * ## Lifetime
 * Rows are written immediately before validation and deleted immediately after,
 * success or failure. The TTL index is a backstop for the case where the worker
 * dies mid-order and never runs its cleanup — without it, abandoned tokens
 * accumulate forever, and a stale token is a URL that answers with a secret
 * for a challenge nobody is waiting on.
 */
@Schema({ timestamps: true, collection: 'acmeChallenges' })
export class AcmeChallenge {
  /**
   * The challenge token — the last path segment of the validation URL.
   *
   * Not a secret in itself (it travels in a URL Let's Encrypt fetches over
   * plain HTTP), which is exactly why the *response* has to be the thing that
   * proves control.
   */
  @Prop({ required: true, trim: true })
  token: string;

  /**
   * What the validation request must be answered with: `<token>.<thumbprint>`,
   * where the thumbprint is derived from our ACME account key.
   *
   * ⚠ This is the secret half. Anyone who can read it can complete a challenge
   * on our account for the hostname it belongs to. It is compared with a
   * constant-time equality check on the way out, and it must never be logged.
   */
  @Prop({ required: true })
  keyAuthorization: string;

  /**
   * Which hostname this challenge belongs to.
   *
   * Recorded for diagnostics rather than for lookup — the responder is handed
   * only a token by the URL, so `token` is what it queries. Having the hostname
   * is what makes a stuck challenge legible in the database.
   */
  @Prop({ required: true, lowercase: true, trim: true })
  hostname: string;

  /**
   * When Mongo should remove this row if nothing else has.
   *
   * Set explicitly rather than derived from `createdAt` so the window can be
   * reasoned about at the call site: a challenge is answered within seconds, and
   * anything still here an hour later is debris from a crashed order.
   */
  @Prop({ type: Date, required: true })
  expiresAt: Date;
}

export const AcmeChallengeSchema = SchemaFactory.createForClass(AcmeChallenge);

/**
 * The responder's only query, and it is on the hot path of certificate
 * issuance — a slow lookup here is a validation timeout.
 */
AcmeChallengeSchema.index({ token: 1 }, { unique: true });

/**
 * TTL cleanup for abandoned challenges.
 *
 * `expireAfterSeconds: 0` means "remove when the date in this field passes",
 * which is what lets the window be set per row above.
 *
 * ⚠ Mongo's TTL monitor runs about once a minute, so removal is eventual, not
 * punctual. That is fine as a backstop — the happy path deletes explicitly —
 * but it does mean this index must never be the only thing preventing a token
 * from being reused.
 */
AcmeChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
