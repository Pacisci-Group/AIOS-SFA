import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

/**
 * Switches between the navy (`dark`) and light themes.
 *
 * Styled to match the "Log out" control it sits above in `AppSidebar`, rather
 * than as a `Button` — that row is a bespoke sidebar affordance.
 *
 * The `mounted` gate is the standard next-themes hydration guard: `theme` is
 * `undefined` on the very first render, so without it the icon and label would
 * change on mount. It renders the dark-mode affordance in the meantime, which
 * matches the default.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = !mounted || theme !== 'light';

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent dark:hover:text-slate-300 dark:hover:bg-white/5 transition-all text-xs"
    >
      {isDark ? <Sun size={13} /> : <Moon size={13} />}
      {isDark ? 'Light mode' : 'Dark mode'}
    </button>
  );
}
