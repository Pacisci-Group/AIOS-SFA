import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AcmeChallenge,
  AcmeChallengeDocument,
} from './schemas/acme-challenge.schema';

/**
 * Looks up the answer to an ACME `http-01` challenge.
 *
 * ## Why this is a service and not just the controller's body
 * Two processes answer this, and they must answer identically.
 *
 * The **edge** answers it in deployed environments. It has to: its upstream is
 * the `web` container, whose nginx has an SPA fallback, so a challenge proxied
 * through would come back as `index.html` with a `200` — which the CA reads as
 * the wrong key authorization, and the order fails with everything appearing to
 * work. Answering at the edge also means validation succeeds while the app
 * containers are restarting, which is exactly when a renewal is likely to land.
 *
 * The **API** answers it on the local dev loop, where there is no edge and
 * requests arrive on port 4000 directly.
 *
 * Two implementations of a lookup this small would drift, and the drift would
 * only show up as certificates that fail to issue in one environment.
 */
@Injectable()
export class AcmeChallengeService {
  constructor(
    @InjectModel(AcmeChallenge.name)
    private readonly challenges: Model<AcmeChallengeDocument>,
  ) {}

  /**
   * The key authorization for a live challenge, or null.
   *
   * Null covers both "no such token" and "expired", deliberately: the caller
   * answers 404 either way, and distinguishing them is only useful to someone
   * probing for live tokens.
   *
   * Expiry is checked here as well as by the collection's TTL index because
   * Mongo's TTL monitor runs about once a minute — removal is eventual, so the
   * row's absence cannot be the only thing enforcing the window.
   */
  async keyAuthorizationFor(token: string): Promise<string | null> {
    if (!token) return null;

    const challenge = await this.challenges
      .findOne({ token })
      .select('keyAuthorization expiresAt')
      .lean();

    if (!challenge || challenge.expiresAt.getTime() <= Date.now()) return null;

    return challenge.keyAuthorization;
  }
}
