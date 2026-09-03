import type { ReactNode } from 'react';

/** Label/value row used across the household and policy drawers. */
export function DrawerRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm text-right break-words">{value ?? '—'}</span>
    </div>
  );
}

export function DrawerSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-border pt-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        {title}
      </h4>
      {children}
    </div>
  );
}

export function DrawerSkeleton() {
  return (
    <div className="space-y-2 animate-pulse" aria-label="Loading">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="h-4 rounded bg-muted" />
      ))}
    </div>
  );
}

export function DrawerError({ message }: { message?: string }) {
  return (
    <p className="text-sm text-destructive">
      {message ?? 'Could not load this record.'}
    </p>
  );
}

/** Format a currency amount, tolerating null. */
export function money(value: number | null | undefined) {
  if (value == null) return '—';
  return `$${value.toLocaleString()}`;
}

/** Format an ISO date string as a short date, tolerating null. */
export function shortDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Render a stored address object as a single line.
 *
 * Each part accepts every key the three writers use, because
 * `households.propertyAddress` is an untyped `Record<string, unknown>` and they
 * never agreed on names — lead intake writes `street/city/state/zip`, the demo
 * seed `line1/...`, and the SmartSuite migration `location_*`. The API's
 * `normalizeStoredAddress` (`common/address/household-address.ts`) documents the
 * same table and is the reason the Quote Recap form works; `GET /households/:id`
 * is the one read path that returns the raw object instead, so the coercion has
 * to happen here.
 *
 * `postalCode` was the original bug: it is not a key **any** writer produces, and
 * `line1` only matches the demo seed — so a migrated household matched nothing at
 * all and the drawer rendered a bare em-dash.
 */
const ADDRESS_KEYS = [
  ['street', 'line1', 'location_address'],
  ['city', 'location_city'],
  ['state', 'location_state'],
  ['zip', 'postalCode', 'location_zip'],
];

export function addressLine(
  address: Record<string, unknown> | null | undefined,
) {
  if (!address) return '—';
  const parts = ADDRESS_KEYS.map((keys) => {
    for (const key of keys) {
      const value = address[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }).filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}
