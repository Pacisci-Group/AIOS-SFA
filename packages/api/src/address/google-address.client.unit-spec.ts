import { ConfigService } from '@nestjs/config';
import {
  AddressLookupError,
  FetchLike,
  GoogleAddressClient,
} from './google-address.client';

/**
 * There is no nock/msw in this repo — third-party clients are tested by
 * injecting a hand-rolled fake, the way `worker/email/resend.transport.unit-spec.ts`
 * builds one for Resend. `GoogleAddressClient` takes its `fetch` through an
 * optional DI token for exactly this.
 *
 * What these cases actually protect: the permanent/transient split (a wrong
 * `permanent` verdict silently disables autocomplete for a whole page session)
 * and the guarantee that a keyless install never issues a billed request.
 */

const config = (values: Record<string, string> = {}) =>
  ({
    get: (key: string, fallback?: string) => values[key] ?? fallback ?? '',
  }) as unknown as ConfigService;

const KEYED = { GOOGLE_MAPS_API_KEY: 'test-key' };

const okResponse = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as Awaited<ReturnType<FetchLike>>;

const errorResponse = (status: number, body = 'nope') =>
  ({
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
  }) as Awaited<ReturnType<FetchLike>>;

describe('GoogleAddressClient', () => {
  describe('without an API key', () => {
    it('reports itself unconfigured and never issues a request', async () => {
      const fetchImpl = jest.fn();
      const client = new GoogleAddressClient(config(), fetchImpl);

      expect(client.configured).toBe(false);
      await expect(
        client.autocomplete('4821 Maple', 'sess-token-1'),
      ).rejects.toThrow(AddressLookupError);
      // A keyless call would 403 — that costs a round-trip and a log line to
      // learn what we already know at construction time.
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe('autocomplete', () => {
    it('sends the key as a header and restricts to US street addresses', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(okResponse({ suggestions: [] }));
      const client = new GoogleAddressClient(config(KEYED), fetchImpl);

      await client.autocomplete('4821 Maple', 'sess-token-1');

      const [url, init] = fetchImpl.mock.calls[0] as [
        string,
        { headers: Record<string, string>; body: string },
      ];
      expect(url).toContain('places:autocomplete');
      // Key in a header, never in the URL — the URL reaches access logs.
      expect(init.headers['X-Goog-Api-Key']).toBe('test-key');
      expect(url).not.toContain('test-key');
      expect(JSON.parse(init.body)).toMatchObject({
        input: '4821 Maple',
        sessionToken: 'sess-token-1',
        includedPrimaryTypes: ['street_address'],
        includedRegionCodes: ['US'],
      });
    });

    it('flattens predictions into suggestions', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(
        okResponse({
          suggestions: [
            {
              placePrediction: {
                placeId: 'ChIJabc',
                structuredFormat: {
                  mainText: { text: '4821 N Maple Ave' },
                  secondaryText: { text: 'Oklahoma City, OK, USA' },
                },
              },
            },
          ],
        }),
      );
      const client = new GoogleAddressClient(config(KEYED), fetchImpl);

      expect(await client.autocomplete('4821 Maple', 'sess-token-1')).toEqual([
        {
          placeId: 'ChIJabc',
          primaryText: '4821 N Maple Ave',
          secondaryText: 'Oklahoma City, OK, USA',
        },
      ]);
    });

    it('drops entries with no place id rather than emitting an unclickable row', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(
        okResponse({
          suggestions: [{ queryPrediction: { text: { text: 'pizza' } } }],
        }),
      );
      const client = new GoogleAddressClient(config(KEYED), fetchImpl);

      expect(await client.autocomplete('pizza', 'sess-token-1')).toEqual([]);
    });
  });

  describe('resolve', () => {
    it('passes the session token and asks only for address components', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(
        okResponse({
          addressComponents: [
            { types: ['street_number'], longText: '4821', shortText: '4821' },
            {
              types: ['route'],
              longText: 'North Maple Avenue',
              shortText: 'N Maple Ave',
            },
            {
              types: ['locality'],
              longText: 'Oklahoma City',
              shortText: 'Oklahoma City',
            },
            {
              types: ['administrative_area_level_1'],
              longText: 'Oklahoma',
              shortText: 'OK',
            },
            { types: ['postal_code'], longText: '73013', shortText: '73013' },
          ],
        }),
      );
      const client = new GoogleAddressClient(config(KEYED), fetchImpl);

      const address = await client.resolve('ChIJabc', 'sess-token-1');

      const [url, init] = fetchImpl.mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];
      expect(url).toContain('/places/ChIJabc');
      // The session token belongs on this call — it is what bundles the
      // preceding keystrokes into one billed session.
      expect(url).toContain('sessionToken=sess-token-1');
      // A wider mask would move Place Details into a dearer SKU tier.
      expect(init.headers['X-Goog-FieldMask']).toBe('addressComponents');
      expect(address).toEqual({
        street: '4821 North Maple Avenue',
        city: 'Oklahoma City',
        state: 'Oklahoma',
        zip: '73013',
      });
    });
  });

  describe('failure classification', () => {
    it('treats a timeout as transient', async () => {
      const abort = Object.assign(new Error('The operation was aborted'), {
        name: 'AbortError',
      });
      const fetchImpl = jest.fn().mockRejectedValue(abort);
      const client = new GoogleAddressClient(config(KEYED), fetchImpl);

      await expect(
        client.autocomplete('4821 Maple', 'sess-token-1'),
      ).rejects.toMatchObject({
        kind: 'transient',
      });
    });

    it.each([400, 401, 403, 404])('treats %i as permanent', async (status) => {
      const fetchImpl = jest.fn().mockResolvedValue(errorResponse(status));
      const client = new GoogleAddressClient(config(KEYED), fetchImpl);

      await expect(
        client.autocomplete('4821 Maple', 'sess-token-1'),
      ).rejects.toMatchObject({
        kind: 'permanent',
        status,
      });
    });

    it.each([429, 500, 503])('treats %i as transient', async (status) => {
      // Unclassified failures default transient: that costs one empty dropdown,
      // where a wrong `permanent` disables the feature for the page session.
      const fetchImpl = jest.fn().mockResolvedValue(errorResponse(status));
      const client = new GoogleAddressClient(config(KEYED), fetchImpl);

      await expect(
        client.autocomplete('4821 Maple', 'sess-token-1'),
      ).rejects.toMatchObject({
        kind: 'transient',
        status,
      });
    });

    it('never leaks the API key or Google’s body into the thrown message', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(
          errorResponse(403, 'API key test-key not authorized'),
        );
      const client = new GoogleAddressClient(config(KEYED), fetchImpl);

      await expect(
        client.autocomplete('4821 Maple', 'sess-token-1'),
      ).rejects.toThrow(/^Google returned 403\.$/);
    });
  });
});
