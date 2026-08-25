import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AddressSuggestion,
  GoogleAddressComponent,
  StructuredAddress,
  mapPlaceComponents,
} from '@sfa/shared';

/**
 * The only thing in this codebase that speaks HTTP to Google Maps Platform
 * (PAC-60).
 *
 * Native `fetch`, following `migration/smartsuite/smartsuite.client.ts` — there
 * is no axios or `@nestjs/axios` anywhere in this API and this must not
 * introduce one. Config and the `configured` flag follow
 * `storage/storage.service.ts`; the permanent-vs-transient split follows
 * `worker/email/resend.transport.ts`.
 *
 * ⚠ **The API key never leaves this file.** It travels as an `X-Goog-Api-Key`
 * header, never a query string, and nothing here is ever returned to a caller.
 * The browser talks to `/api/v1/address/*` and receives `StructuredAddress`;
 * that is the entire reason these calls are proxied rather than made from a
 * `<gmp-place-autocomplete>` element with a browser-side key.
 */

/** Injection token for the `fetch` seam — overridden in unit tests. */
export const ADDRESS_FETCH = Symbol('ADDRESS_FETCH');

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

/**
 * Why a lookup failed, in the only terms the caller acts on.
 *
 * `permanent` means retrying changes nothing — a missing/revoked key, an API
 * not enabled on the project, a malformed request. `transient` means the next
 * keystroke might well succeed — a timeout, a 5xx, a quota blip.
 *
 * The distinction matters because the two get different HTTP treatment: a
 * permanent failure latches `available: false` on the client and stops the
 * traffic, a transient one just returns no suggestions for that keystroke.
 */
export type AddressFailureKind = 'permanent' | 'transient';

export class AddressLookupError extends Error {
  constructor(
    readonly kind: AddressFailureKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AddressLookupError';
  }
}

interface PlacePrediction {
  placeId?: string;
  structuredFormat?: {
    mainText?: { text?: string };
    secondaryText?: { text?: string };
  };
  text?: { text?: string };
}

interface AutocompleteBody {
  suggestions?: { placePrediction?: PlacePrediction }[];
}

interface PlaceDetailsBody {
  addressComponents?: GoogleAddressComponent[];
}

const DEFAULT_PLACES_BASE_URL = 'https://places.googleapis.com/v1';
const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Statuses that will not improve on retry. Anything not listed is treated as
 * transient — the safer default when the failure is unclassified, since a
 * transient verdict costs one empty dropdown while a wrong `permanent` verdict
 * silently disables autocomplete for the rest of the page session.
 */
const PERMANENT_STATUSES = new Set([400, 401, 403, 404]);

@Injectable()
export class GoogleAddressClient {
  private readonly logger = new Logger(GoogleAddressClient.name);
  private readonly apiKey: string;
  private readonly placesBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  /** False when no API key is configured — see `AddressService`'s fail-open note. */
  readonly configured: boolean;

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(ADDRESS_FETCH) fetchImpl?: FetchLike,
  ) {
    this.apiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY', '').trim();
    this.configured = Boolean(this.apiKey);
    this.placesBaseUrl = this.config.get<string>(
      'GOOGLE_PLACES_BASE_URL',
      DEFAULT_PLACES_BASE_URL,
    );
    this.timeoutMs =
      Number(this.config.get<string>('GOOGLE_MAPS_TIMEOUT_MS', '')) ||
      DEFAULT_TIMEOUT_MS;
    this.fetchImpl = fetchImpl ?? globalThis.fetch;

    if (!this.configured) {
      // Deliberately `warn`, not `error`, and deliberately not a throw. Address
      // autocomplete is an assist: with no key the forms behave exactly as they
      // did before PAC-60. Contrast `mail-transport.provider.ts`, which is loud
      // because a missing key there means a lost email.
      this.logger.warn(
        'GOOGLE_MAPS_API_KEY is not set — address autocomplete is disabled. ' +
          'Address fields still accept free text (see .env.example).',
      );
    }
  }

  /**
   * Predictions for a partially-typed address.
   *
   * `includedPrimaryTypes: ['street_address']` keeps businesses and cities out
   * of a field that wants a mailing address; `includedRegionCodes: ['US']`
   * matches the agency's footprint (non-US addresses are out of scope for
   * PAC-60).
   */
  async autocomplete(
    input: string,
    sessionToken: string,
  ): Promise<AddressSuggestion[]> {
    const body = await this.request<AutocompleteBody>(
      `${this.placesBaseUrl}/places:autocomplete`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          input,
          sessionToken,
          includedPrimaryTypes: ['street_address'],
          includedRegionCodes: ['US'],
        }),
      },
    );

    return (body.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is PlacePrediction => Boolean(p?.placeId))
      .map((p) => ({
        placeId: p.placeId as string,
        primaryText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
      }))
      .filter((s) => s.primaryText);
  }

  /**
   * Resolve a chosen prediction into address components.
   *
   * **This terminates the billing session.** Passing the same `sessionToken`
   * the autocomplete keystrokes carried is what bundles them; a mismatched or
   * missing token gets every keystroke billed standalone. The field mask is
   * kept to `addressComponents` on purpose — Place Details is billed by SKU
   * tier, and asking for fields nothing reads moves the call into a dearer one.
   */
  async resolve(
    placeId: string,
    sessionToken: string,
  ): Promise<StructuredAddress> {
    const encoded = encodeURIComponent(placeId);
    const body = await this.request<PlaceDetailsBody>(
      `${this.placesBaseUrl}/places/${encoded}?sessionToken=${encodeURIComponent(sessionToken)}`,
      {
        method: 'GET',
        headers: {
          ...this.headers(),
          'X-Goog-FieldMask': 'addressComponents',
        },
      },
    );

    return mapPlaceComponents(body.addressComponents);
  }

  private headers(): Record<string, string> {
    return {
      'X-Goog-Api-Key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<T> {
    if (!this.configured) {
      // Never issue a keyless request — Google would 403 it, which costs a
      // round-trip and a log line to learn what we already know.
      throw new AddressLookupError(
        'permanent',
        'Google Maps API key is not configured.',
      );
    }

    let res: Awaited<ReturnType<FetchLike>>;
    try {
      /*
       * A timeout is not optional here, unlike in the two clients this one is
       * modelled on. Those run in a migration script and a background worker;
       * this one sits in the keystroke path of a form a producer is typing
       * into, so a hung socket is a hung field.
       */
      res = await this.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`Google address request failed: ${message}`);
      throw new AddressLookupError('transient', message);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const kind: AddressFailureKind = PERMANENT_STATUSES.has(res.status)
        ? 'permanent'
        : 'transient';
      // Google echoes the request back in some error bodies, so truncate and
      // never re-raise the body to the caller.
      const detail = text.slice(0, 500);
      const log = `Google address request rejected (${res.status}): ${detail}`;
      if (kind === 'permanent') this.logger.error(log);
      else this.logger.warn(log);
      throw new AddressLookupError(
        kind,
        `Google returned ${res.status}.`,
        res.status,
      );
    }

    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new AddressLookupError('transient', (err as Error).message);
    }
  }
}
