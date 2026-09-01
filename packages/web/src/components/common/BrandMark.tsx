import { Shield } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTenant } from '@/contexts/tenant-context';
import { cn } from '@/lib/utils';

/**
 * Logo boxes, in **pixels rather than Tailwind's rem scale**.
 *
 * `theme.css` sets `html { font-size: 15px }`, so `max-h-8` is 30px here, not
 * the 32 everyone assumes. The email masthead is a literal `height="32"` and
 * cannot read a CSS variable, so the rem scale had the app and the email
 * rendering the same uploaded file at two different sizes. Pixels keep them
 * identical.
 *
 * **Both axes are capped.** Height alone is not enough: `w-auto` on a wide
 * banner scaled to 32px tall is still ~240px wide, which is wider than the
 * entire 224px sidebar and far wider than the 56px collapsed rail. Without a
 * max-width one upload silently breaks the shell.
 */
const SIZES = {
  /** App shell. Sits *beside* the agency name, so it must stay near-square. */
  sm: { box: 'size-8', icon: 'size-4', logo: 'max-h-[32px] max-w-[48px]' },
  /** Login / accept-invite. Has a line to itself, so a wordmark fits. */
  md: { box: 'size-10', icon: 'size-5', logo: 'max-h-[40px] max-w-[160px]' },
} as const;

/**
 * The agency's logo, or the shield fallback.
 *
 * One component rather than the four near-identical copies this replaces (the
 * sidebar, the login page, the accept-invite page and the dev navigator) — the
 * same consolidation `DetailCard` got once three pages had each grown their own
 * card idiom. Four copies is how one of them keeps the old wordmark through the
 * next change.
 *
 * ## Theme-aware, with a fallback that matters
 * An agency may upload a second logo for the dark theme, because a dark-ink
 * mark is invisible on the navy sidebar. When they have not, `logoDarkUrl`
 * falls back to the light one server-side — a slightly-wrong logo beats a
 * missing one.
 */
export function BrandMark({
  size = 'sm',
  className,
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { branding } = useTenant();
  const { resolvedTheme } = useTheme();
  const s = SIZES[size];

  const logoUrl =
    resolvedTheme === 'dark'
      ? (branding.logoDarkUrl ?? branding.logoUrl)
      : branding.logoUrl;

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        // The agency name, not "logo": with images blocked or slow, this is the
        // only thing identifying whose app this is.
        alt={branding.name}
        className={cn('w-auto object-contain', s.logo, className)}
      />
    );
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg bg-primary',
        s.box,
        className,
      )}
    >
      <Shield className={cn(s.icon, 'text-primary-foreground')} />
    </div>
  );
}

/**
 * The mark plus the wordmark and a caption.
 *
 * `tagline` overrides the tenant's own — the dev navigator and the sidebar each
 * label themselves ("Screen Navigator", "Agency Portal") rather than repeating
 * the agency's marketing line.
 */
export function BrandLockup({
  size = 'sm',
  tagline,
  className,
}: {
  size?: keyof typeof SIZES;
  tagline?: string;
  className?: string;
}) {
  const { branding } = useTenant();

  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <BrandMark size={size} />
      <div className="min-w-0">
        <p
          className={cn(
            'truncate font-bold tracking-tight text-foreground',
            size === 'md' ? 'text-lg' : 'text-sm leading-tight',
          )}
        >
          {branding.name}
        </p>
        <p className="truncate text-[10px] tracking-widest text-muted-foreground uppercase">
          {tagline ?? branding.tagline}
        </p>
      </div>
    </div>
  );
}
