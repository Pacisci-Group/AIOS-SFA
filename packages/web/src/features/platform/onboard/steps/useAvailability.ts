import { useEffect, useState } from "react";
import { checkAgencyAvailability } from "@/lib/platform-api";

/** How long to wait after the last keystroke before asking the server. */
const DEBOUNCE_MS = 400;

type Field = "slug" | "email" | "ticker";

/**
 * Is this value still free? Debounced, and safe to render from.
 *
 * Answers `null` until there is an answer — for an empty value, while in
 * flight, and if the request fails. A failure is deliberately silent: this is a
 * convenience check, the server re-checks on submit under the same rules, and a
 * red "could not verify" on a field the operator has typed correctly is worse
 * than no hint at all.
 *
 * Stale responses are dropped by a cancellation flag rather than by comparing
 * values, so a slow answer for "acme" can never overwrite a fast one for
 * "acme-insurance".
 */
export function useAvailability(field: Field, value: string): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  const trimmed = value.trim();

  useEffect(() => {
    if (!trimmed) {
      setAvailable(null);
      return;
    }
    let cancelled = false;
    setAvailable(null);

    const timer = setTimeout(() => {
      void checkAgencyAvailability({ [field]: trimmed })
        .then((result) => {
          if (cancelled) return;
          setAvailable(
            field === "slug"
              ? result.slugAvailable
              : field === "email"
                ? result.emailAvailable
                : result.tickerAvailable,
          );
        })
        .catch(() => {
          if (!cancelled) setAvailable(null);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [field, trimmed]);

  return available;
}
