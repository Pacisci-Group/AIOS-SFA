import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchTenantBranding,
  PLATFORM_BRANDING,
  readCachedBranding,
  type TenantBranding,
} from '@/lib/tenant-api';

interface TenantContextValue {
  branding: TenantBranding;
  /** True while the first fetch is in flight. Rarely worth blocking on. */
  isLoading: boolean;
  /**
   * Re-read the branding for this host.
   *
   * For the settings page: an owner who uploads a logo must see the sidebar and
   * tab title change, and those read from here rather than from the settings
   * query. Without it the save appears to have done nothing.
   */
  refresh: () => Promise<void>;
  /**
   * This hostname serves no tenant.
   *
   * `App` renders a plain "not configured" page instead of the router when this
   * is set. It must **not** fall through to the ordinary login screen: every
   * request from an unrecognised host is refused by `HostTenantGuard`, so the
   * form would take correct credentials and fail without explanation.
   */
  unknownHost: boolean;
}

const TenantContext = createContext<TenantContextValue | null>(null);

/**
 * Makes the current host's white-label identity available to the whole app.
 *
 * ## Why it does not gate rendering
 * It starts from the `localStorage` cache and only ever *refines* — it never
 * shows a spinner. Blocking the tree on this fetch would put a loading screen
 * in front of the login page for every cold visit, which is a worse trade than
 * a returning user very occasionally seeing a one-frame-stale wordmark.
 *
 * ## Mounted above `AuthProvider`
 * On purpose: the login page is branded, and it renders before anyone is
 * authenticated. Nothing here depends on a session.
 */
export function TenantProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<TenantBranding>(
    () => readCachedBranding() ?? PLATFORM_BRANDING,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [unknownHost, setUnknownHost] = useState(false);

  const refresh = useCallback(async () => {
    const next = await fetchTenantBranding();
    setBranding(next.branding);
    setUnknownHost(next.unknownHost);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetchTenantBranding().then((next) => {
      if (cancelled) return;
      setBranding(next.branding);
      setUnknownHost(next.unknownHost);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // The tab title and favicon live outside React's tree, so they are written
  // imperatively. The pre-paint script in `index.html` has usually done this
  // already from the cache; this is what corrects it after the fetch.
  useEffect(() => {
    // An unknown host must not be labelled with the platform brand. The markup
    // ships `<title>AgencyOps</title>` as its initial value, so leaving this
    // alone would put our name on the tab of an address we do not serve —
    // the same misdirection the page body was fixed to avoid.
    document.title = unknownHost ? 'Address not available' : branding.name;
    applyFavicon(branding.faviconUrl);
  }, [branding, unknownHost]);

  const value = useMemo(
    () => ({ branding, isLoading, refresh, unknownHost }),
    [branding, isLoading, refresh, unknownHost],
  );

  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error('useTenant must be used within TenantProvider');
  }
  return ctx;
}

/**
 * Point the tab icon at the agency's favicon, or leave the bundled default.
 *
 * Deliberately does **not** clear the href when there is no tenant favicon:
 * removing it would fall back to the browser's blank page icon rather than to
 * our own, which looks like a broken deploy rather than an unbranded tenant.
 */
function applyFavicon(faviconUrl: string | null): void {
  if (!faviconUrl) return;

  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = faviconUrl;
}
