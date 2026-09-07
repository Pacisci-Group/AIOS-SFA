import type { MailerCampaignSettings } from '@sfa/shared';

/**
 * A campaign's settings as a **plain object honouring the shared interface**.
 *
 * ⚠ Not decoration — it repairs two ways a stored `settings` fails to be the
 * `MailerCampaignSettings` its type claims, both invisible at compile time
 * because the Mongoose sub-document class and the shared interface have the
 * same shape.
 *
 * 1. **A sub-document keeps its values in `_doc`**, not as own enumerable
 *    properties, so `{...settings}` copies *nothing*. The transform then reads
 *    `settings.marketPhones` as `undefined` and throws on the first row it
 *    prices.
 * 2. **Mongoose's `minimize` strips empty objects on save**, so a run with no
 *    ZIP fixes stored no `zipResolutions` key at all — and the interface
 *    declares it required, so a reader calling `Object.keys` on it is a white
 *    screen rather than a missing row. `MailerCampaignSettingsDoc` now sets
 *    `minimize: false`, which covers documents written from here on; this is
 *    what keeps every campaign written before that from breaking the contract.
 *
 * Lives in `common/` because the worker's jobs and the request-side service
 * both need it, and the worker's import boundary admits `common/` but not a
 * feature directory. One conversion, named once, is what stops the two sides
 * disagreeing about what a stored setting is.
 */
export function plainSettings(
  settings: unknown,
): MailerCampaignSettings | null {
  if (!settings) return null;
  const doc = settings as { toObject?: () => MailerCampaignSettings };
  const plain =
    typeof doc.toObject === 'function'
      ? doc.toObject()
      : (settings as MailerCampaignSettings);

  return {
    ...plain,
    marketPhones: plain.marketPhones ?? {},
    zipResolutions: plain.zipResolutions ?? {},
  };
}
