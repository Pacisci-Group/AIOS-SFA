import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as acme from 'acme-client';
import {
  acmeContactEmail,
  acmeDirectoryUrl,
  isProductionCa,
} from '../../config/acme.config';
import {
  decryptSecret,
  encryptSecret,
  readEncryptionKey,
} from '../../common/crypto/at-rest-cipher';
import {
  AcmeAccount,
  AcmeAccountDocument,
} from '../../tls/schemas/acme-account.schema';

/** Mongo's duplicate-key error. */
const DUPLICATE_KEY = 11000;

/**
 * Owns the one ACME account this environment issues certificates under.
 *
 * ## Why an account is a persisted thing
 * `acme-client` will generate an account key whenever asked, and everything
 * appears to work — which is precisely the problem. Let's Encrypt caps new
 * registrations per IP over a rolling window, so an account created per
 * issuance spends that allowance on nothing, and the cap is reached at exactly
 * the moment a burst of domains is being onboarded.
 *
 * So the account key is minted once, encrypted, and stored. Every worker in
 * every replica reads the same row.
 */
@Injectable()
export class AcmeAccountService {
  private readonly logger = new Logger(AcmeAccountService.name);

  /**
   * Memoised client, so a renewal sweep over fifty certificates does not read
   * and decrypt the account key fifty times.
   *
   * Safe to hold for the life of the process: the account key never rotates
   * in place — a new CA endpoint means a different row and a different client,
   * which is why the cache is keyed by directory URL.
   */
  private cached: { directoryUrl: string; client: acme.Client } | null = null;

  constructor(
    @InjectModel(AcmeAccount.name)
    private readonly accounts: Model<AcmeAccountDocument>,
    private readonly config: ConfigService,
  ) {}

  /** The CA this environment is pointed at. */
  directoryUrl(): string {
    return acmeDirectoryUrl(this.config.get<string>('ACME_DIRECTORY_URL'));
  }

  /**
   * An `acme.Client` bound to this environment's registered account,
   * registering it on first use.
   */
  async client(): Promise<acme.Client> {
    const directoryUrl = this.directoryUrl();
    if (this.cached?.directoryUrl === directoryUrl) return this.cached.client;

    const key = readEncryptionKey(
      this.config.get<string>('CERT_ENCRYPTION_KEY'),
    );

    const record = await this.loadOrRegister(directoryUrl, key);

    const client = new acme.Client({
      directoryUrl,
      accountKey: decryptSecret(record.accountKeyPemEncrypted, key),
      // Supplying the URL skips a lookup round trip on every process start.
      accountUrl: record.accountUrl ?? undefined,
    });

    this.cached = { directoryUrl, client };

    // Worth one line at boot: "which CA is this environment using" is the first
    // question asked when certificates are not trusted, and staging is the
    // default, so an environment that forgot to opt in should say so out loud.
    this.logger.log(
      `ACME account ready at ${directoryUrl}` +
        (isProductionCa(directoryUrl)
          ? ''
          : ' — STAGING CA: issued certificates will NOT be trusted by browsers.'),
    );

    return client;
  }

  /**
   * Read the account row, creating and registering one if this is a cold
   * environment.
   *
   * ## The race, and why the unique index resolves it
   * On a cold database every worker that wakes up finds no row and tries to
   * register. Without the unique index on `directoryUrl` they would all
   * succeed, each with a different key, and each worker would then sign with
   * whichever account it happened to create — with orders and authorizations
   * scattered across several accounts that know nothing of each other.
   *
   * With the index, exactly one insert wins and the rest fail with E11000 and
   * re-read. The losers have registered an account at the CA that nothing will
   * ever use again, which is untidy and harmless; the alternative — taking a
   * lock before registering — would mean a lock held across a network call to
   * a third party on the cold-start path.
   */
  private async loadOrRegister(
    directoryUrl: string,
    key: Buffer,
  ): Promise<AcmeAccount> {
    const existing = await this.accounts.findOne({ directoryUrl }).lean();
    if (existing) return existing;

    this.logger.log(`No ACME account for ${directoryUrl} — registering one.`);

    const accountKeyPem = (await acme.crypto.createPrivateKey()).toString();
    const contactEmail = acmeContactEmail(
      this.config.get<string>('ACME_CONTACT_EMAIL'),
    );

    const client = new acme.Client({ directoryUrl, accountKey: accountKeyPem });
    await client.createAccount({
      termsOfServiceAgreed: true,
      ...(contactEmail ? { contact: [`mailto:${contactEmail}`] } : {}),
    });

    try {
      return await this.accounts.create({
        directoryUrl,
        accountKeyPemEncrypted: encryptSecret(accountKeyPem, key),
        accountUrl: client.getAccountUrl(),
        contactEmail,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error as Error & { code?: number }).code === DUPLICATE_KEY
      ) {
        // Another worker registered first. Theirs is the account of record.
        this.logger.log(
          'Another worker registered the ACME account first — using theirs.',
        );
        const winner = await this.accounts.findOne({ directoryUrl }).lean();
        if (winner) return winner;
      }
      throw error;
    }
  }
}
