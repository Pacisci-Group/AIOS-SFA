import { useCallback, useEffect, useState } from 'react';

/**
 * Persisted across logout by the allowlist in `lib/api-client.ts` — it
 * describes the browser, not the account. Keep the two in step.
 */
const STORAGE_KEY = 'sidebar:collapsed';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // Storage may be unavailable (Safari private mode); default to expanded.
    return false;
  }
}

/**
 * Whether the app sidebar is collapsed to its icon rail, persisted per browser.
 *
 * Deliberately component-local state rather than a context provider: exactly one
 * `AppSidebar` is mounted at a time (every page composes its own shell — there
 * is no shared layout route yet), and the toggle lives inside the sidebar. A
 * provider would only be needed if a page header had to render a trigger.
 *
 * The lazy `useState` initialiser reads storage once on mount rather than on
 * every render. There is no pre-paint script for this the way there is for the
 * theme, so a collapsed sidebar renders expanded for one frame on a cold load;
 * that is a 260px→68px reflow, not a colour flash, and not worth an inline
 * script in `index.html` to avoid.
 */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(readStored);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // Ignore — the preference simply won't survive a reload.
    }
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed((prev) => !prev), []);

  /**
   * ⌘B / Ctrl+B, the convention every editor and shadcn's own sidebar use.
   *
   * Bound on `window` rather than the `<aside>` so it works wherever focus is,
   * and skipped while the user is typing — otherwise ⌘B in the note composer
   * would collapse the nav instead of doing nothing.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'b') return;
      if (!event.metaKey && !event.ctrlKey) return;

      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')
      ) {
        return;
      }

      event.preventDefault();
      toggle();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  return { collapsed, toggle };
}
