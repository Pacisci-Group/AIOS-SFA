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

/** Render a stored address object as a single line. */
export function addressLine(
  address: Record<string, unknown> | null | undefined,
) {
  if (!address) return '—';
  const parts = ['line1', 'city', 'state', 'postalCode']
    .map((key) => address[key])
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  return parts.length ? parts.join(', ') : '—';
}
