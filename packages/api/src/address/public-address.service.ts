import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AddressAutocompleteResponse,
  AddressResolveResponse,
} from '@sfa/shared';
import { Model } from 'mongoose';
import { PUBLIC_ADDRESS_LINK_DAILY_LIMIT } from '../config/rate-limit.config';
import {
  ShareLink,
  ShareLinkDocument,
} from '../share-links/schemas/share-link.schema';
import { ShareLinkAccessService } from '../share-links/share-link-access.service';
import { AddressService } from './address.service';

const DAY_MS = 86_400_000;

/**
 * Address lookup for the unauthenticated intake form (PAC-60).
 *
 * Wraps {@link AddressService} with the two things `@Public()` takes away: the
 * guard chain's tenancy checks, and any notion of who is calling.
 *
 * ## Three layers of spend control, and why each exists
 *
 * 1. **A quota cap on the Google key.** The only *hard* stop; budgets merely
 *    alert. Configured in GCP, not here.
 * 2. **The per-IP `@Throttle`** on the controller. Stops one machine hammering.
 * 3. **A per-link daily cap, here.** The layer that matters: the attack that
 *    costs real money is one scraped share link driven from many IPs, and per-IP
 *    throttling structurally cannot see it.
 *
 * When the per-link cap trips, callers get a plain `available: false` rather
 * than a 429. That is deliberate and differs from the intake limits: the client
 * latches `available: false` and stops asking for the rest of the page session,
 * which is exactly the behaviour we want, and the submitter can still type the
 * address by hand and submit. A 429 would surface as an error on a form that is
 * working fine.
 */
@Injectable()
export class PublicAddressService {
  private readonly logger = new Logger(PublicAddressService.name);

  constructor(
    @InjectModel(ShareLink.name)
    private readonly shareLinkModel: Model<ShareLinkDocument>,
    private readonly shareLinkAccess: ShareLinkAccessService,
    private readonly addressService: AddressService,
  ) {}

  async autocomplete(
    token: string,
    input: string,
    sessionToken: string,
  ): Promise<AddressAutocompleteResponse> {
    if (!(await this.claimLookup(token))) {
      return { available: false, suggestions: [] };
    }
    return this.addressService.autocomplete(input, sessionToken);
  }

  async resolve(
    token: string,
    placeId: string,
    sessionToken: string,
  ): Promise<AddressResolveResponse> {
    if (!(await this.claimLookup(token))) {
      return { available: false, address: null };
    }
    return this.addressService.resolve(placeId, sessionToken);
  }

  /**
   * Verify the share link and consume one unit of its daily allowance.
   *
   * Throws the generic "no longer available" 404 for an invalid link — the same
   * one `GET /public/lead-form/:token` returns, so this endpoint cannot be used
   * to probe which tokens exist. Returns `false` only when the link is
   * legitimate but out of allowance.
   */
  private async claimLookup(token: string): Promise<boolean> {
    // Throws generically on anything wrong with the link, the agency, the
    // `leads` module entitlement or the producer. One implementation, shared
    // with the intake routes, so the non-disclosure property cannot drift.
    const { link } = await this.shareLinkAccess.resolve(token);

    const now = Date.now();
    const windowStart = link.addressLookupWindowStart?.getTime() ?? 0;
    const windowExpired = now - windowStart >= DAY_MS;

    /*
     * Reset and increment in one atomic write, so two concurrent requests
     * cannot both observe an expired window and both reset the counter to 1.
     * The window rolls lazily — there is no sweeper, and a link nobody touches
     * for a week simply starts fresh on its next lookup.
     */
    const updated = await this.shareLinkModel.findOneAndUpdate(
      { _id: link._id },
      windowExpired
        ? {
            $set: {
              addressLookupCount: 1,
              addressLookupWindowStart: new Date(now),
            },
          }
        : { $inc: { addressLookupCount: 1 } },
      { new: true, projection: { addressLookupCount: 1 } },
    );

    const count = updated?.addressLookupCount ?? 0;
    if (count > PUBLIC_ADDRESS_LINK_DAILY_LIMIT) {
      // Once per trip would be ideal; once per request over the cap is
      // acceptable because the cap itself bounds how often that can happen.
      this.logger.warn(
        `Share link ${link._id.toString()} exceeded its daily address-lookup allowance ` +
          `(${count}/${PUBLIC_ADDRESS_LINK_DAILY_LIMIT}) — serving available:false.`,
      );
      return false;
    }

    return true;
  }
}
