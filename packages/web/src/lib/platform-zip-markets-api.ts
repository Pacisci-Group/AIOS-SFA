import type { MailerZipMarket, MailerZipMarketListResponse } from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

/**
 * The ZIP → market table (PAC-71).
 *
 * Replaces ApexReports' Google Sheet. Platform-global: a campaign can serve many
 * agencies, so during a preview no single agency owns the resolution. The
 * `agencyId` column exists so per-agency overrides are additive later with no
 * migration — nothing here sends one.
 */

export type { MailerZipMarket, MailerZipMarketListResponse };

export const zipMarketsKey = ['platform', 'zip-markets'] as const;
export const zipMarketsListKey = (params: ListZipMarketsParams) =>
  [...zipMarketsKey, params] as const;

export interface ListZipMarketsParams {
  page?: number;
  pageSize?: number;
  /** Prefix on the ZIP, or a substring of the market name. */
  q?: string;
}

export function listZipMarkets(params: ListZipMarketsParams = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return apiFetch<MailerZipMarketListResponse>(
    `/platform/mailer-zip-markets${qs ? `?${qs}` : ''}`,
  );
}

export interface ZipMarketEntry {
  zip5: string;
  market: string;
}

/**
 * Upsert one row, a hand-typed correction, or a pasted block.
 *
 * `PUT` rather than `POST` because every write is keyed on `(agencyId, zip5)`:
 * sending the same block twice leaves the table in the same state.
 */
export function upsertZipMarkets(entries: ZipMarketEntry[]) {
  return apiFetch<{ upserted: number; updated: number }>(
    '/platform/mailer-zip-markets',
    {
      method: 'PUT',
      body: JSON.stringify({ entries }),
    },
  );
}

export function deleteZipMarket(id: string) {
  return apiFetch<{ deleted: true }>(
    `/platform/mailer-zip-markets/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}
