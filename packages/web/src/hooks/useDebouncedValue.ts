import { useEffect, useState } from 'react';

/**
 * Debounce a rapidly-changing value (typically a search box) so it only reaches
 * the query layer once the user pauses. 300ms matches the legacy Leads page.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
