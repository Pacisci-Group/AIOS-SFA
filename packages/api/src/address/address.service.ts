import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  AddressAutocompleteResponse,
  AddressResolveResponse,
  isEmptyAddress,
  withDefaultState,
} from '@sfa/shared';
import {
  AddressLookupError,
  GoogleAddressClient,
} from './google-address.client';

/**
 * Address autocomplete, shaped for the form that consumes it (PAC-60).
 *
 * ## This endpoint fails open, on purpose
 *
 * Every response carries `available`, and the client acts on that rather than
 * on the HTTP status. A missing API key, a revoked key, an API not enabled on
 * the GCP project or a Google outage all come back `200 { available: false }`.
 *
 * The alternative — throwing 503 — was rejected because this call fires on a
 * debounced keystroke. A 503 per keystroke means an error toast per keystroke
 * and a log line per keystroke, for a feature whose entire job is to save
 * typing. The address fields still accept free text and the form still submits;
 * the only thing lost is the dropdown.
 *
 * Temperament-wise this sits with `permission-cache.provider.ts` (degrade
 * quietly, the request still works) rather than `mail-transport.provider.ts`
 * (shout, because the email is gone). Autocomplete cannot cost a lead — see
 * the "never blocks a submission" acceptance criterion on PAC-60, which is
 * held structurally: no submit path in this API calls Google.
 */
@Injectable()
export class AddressService {
  private readonly logger = new Logger(AddressService.name);

  constructor(private readonly google: GoogleAddressClient) {}

  async autocomplete(
    input: string,
    sessionToken: string,
  ): Promise<AddressAutocompleteResponse> {
    if (!this.google.configured) {
      return { available: false, suggestions: [] };
    }

    try {
      return {
        available: true,
        suggestions: await this.google.autocomplete(input, sessionToken),
      };
    } catch (err) {
      // Both kinds return 200 here. `available` is what differs: a permanent
      // failure tells the client to stop asking for the rest of the page
      // session, a transient one is just an empty dropdown for this keystroke.
      const permanent =
        err instanceof AddressLookupError && err.kind === 'permanent';
      return { available: !permanent, suggestions: [] };
    }
  }

  /**
   * Resolve a chosen prediction, and terminate the billing session.
   *
   * Unlike autocomplete this one **does** surface a hard failure: the user has
   * clicked a specific suggestion and is waiting for four fields to fill in, so
   * silently doing nothing would read as a broken control rather than as a
   * missing convenience. `available: false` still covers the unconfigured case
   * — the field simply never offered a suggestion to click in the first place.
   */
  async resolve(
    placeId: string,
    sessionToken: string,
  ): Promise<AddressResolveResponse> {
    if (!this.google.configured) {
      return { available: false, address: null };
    }

    try {
      const mapped = await this.google.resolve(placeId, sessionToken);
      // Nothing usable came back — hand the caller `null` so it leaves what the
      // user typed alone rather than blanking four fields.
      if (isEmptyAddress(mapped)) {
        this.logger.warn(
          `Place ${placeId} resolved to no usable address components.`,
        );
        return { available: true, address: null };
      }
      return { available: true, address: withDefaultState(mapped) };
    } catch (err) {
      if (err instanceof AddressLookupError && err.status === 400) {
        // A place id we did not mint, or one from a different project.
        throw new BadRequestException(
          'That address suggestion could not be resolved.',
        );
      }
      const permanent =
        err instanceof AddressLookupError && err.kind === 'permanent';
      return { available: !permanent, address: null };
    }
  }
}
