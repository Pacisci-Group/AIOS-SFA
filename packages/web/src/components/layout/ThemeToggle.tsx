import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

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
export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = !mounted || theme !== 'light';
  const label = isDark ? 'Light mode' : 'Dark mode';

  const button = (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={cn(
        'w-full flex items-center gap-2.5 py-2 rounded-md text-muted-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors text-sm outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        collapsed ? 'justify-center px-0' : 'px-2.5',
      )}
    >
      {isDark ? (
        <Sun className="size-4 shrink-0" />
      ) : (
        <Moon className="size-4 shrink-0" />
      )}
      {!collapsed && label}
    </button>
  );

  if (!collapsed) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
