import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AcmeAccountDocument = HydratedDocument<AcmeAccount>;

/**
 * Our registered account with an ACME certificate authority.
 *
 * ## Why this is persisted rather than created per run
 * An ACME account is a keypair the CA knows us by. `acme-client` will happily
 * generate a fresh one on every call, and everything appears to work — until
 * the rate limits bite. Let's Encrypt caps new registrations per IP address, and
 * an account created per issuance burns that allowance for no benefit. Worse, a
 * new account has no history, so none of the per-account allowances that make
 * renewals cheap apply.
 *
 * The same reasoning that puts certificates in Mongo puts this here: every
 * worker must use the *same* account, and workers are interchangeable
 * processes with no shared disk.
 *
 * ## Keyed by directory URL
 * One row per CA endpoint, so staging and production are separate accounts that
 * cannot be confused for one another. This matters more than it sounds:
 * Let's Encrypt's staging and production environments are entirely separate
 * services, an account on one is meaningless on the other, and the failure mode
 * of mixing them is an authorization error that says nothing about the cause.
 *
 * It also means switching an environment from staging to production is a
 * configuration change that registers a new account on first use, rather than
 * something requiring a manual reset.
 */
@Schema({ timestamps: true, collection: 'acmeAccounts' })
export class AcmeAccount {
  /**
   * The ACME directory URL this account belongs to — for example
   * `https://acme-staging-v02.api.letsencrypt.org/directory`.
   */
  @Prop({ required: true, trim: true })
  directoryUrl: string;

  /**
   * The account private key, PEM, encrypted with `CERT_ENCRYPTION_KEY`.
   *
   * ⚠ This key *is* the account. Anyone holding it can issue certificates for
   * any domain we have already proven control of, and can revoke certificates we
   * have issued. It is the highest-value secret in this subsystem — higher than
   * any individual certificate's key, which compromises one hostname.
   */
  @Prop({ required: true })
  accountKeyPemEncrypted: string;

  /**
   * The account URL the CA assigned, returned on registration.
   *
   * Stored so a later run can address the existing account directly rather than
   * re-registering. `acme-client` can rediscover it from the key alone, but
   * having it recorded makes "which account is this environment using?"
   * answerable without a round trip to the CA.
   */
  @Prop({ type: String, default: null })
  accountUrl: string | null;

  /** The contact address registered with the CA. Diagnostics only. */
  @Prop({ type: String, trim: true, default: null })
  contactEmail: string | null;
}

export const AcmeAccountSchema = SchemaFactory.createForClass(AcmeAccount);

/**
 * One account per CA.
 *
 * Unique so that two workers racing to register on a cold database cannot both
 * succeed — the loser's insert fails and it re-reads the winner's row, which is
 * the behaviour we want. Without this, a first deploy under any concurrency
 * quietly creates two accounts and each worker signs with whichever it found.
 */
AcmeAccountSchema.index({ directoryUrl: 1 }, { unique: true });
