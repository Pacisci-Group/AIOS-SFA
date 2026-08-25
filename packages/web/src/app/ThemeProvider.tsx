import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * Owns the `light`/`dark` class on `<html>`.
 *
 * Two settings here are load-bearing rather than stylistic:
 *
 * - **`defaultTheme="dark"`** — the navy theme is what the app shipped as, so
 *   it stays the default. Anyone who has never touched the toggle keeps
 *   exactly what they had.
 * - **`enableSystem={false}`** — deliberately *not* the library default. With
 *   system detection on, every existing user whose OS is set to light would be
 *   silently repainted on their next load. Light mode is opt-in, via the
 *   toggle, and only then persisted.
 *
 * The pre-paint class is written by the inline script in `index.html`; this
 * provider takes over afterwards. Keep `storageKey` and the default in sync
 * with that script.
 *
 * `ui/sonner.tsx` calls `useTheme()` and until now resolved to `"system"` with
 * no provider mounted — it picks up the real theme for free once this is in
 * the tree.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      storageKey="theme"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
