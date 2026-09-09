import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PAGES,
  type PageLevel,
  type PageLevelOverride,
} from '@sfa/shared';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Info,
  RotateCcw,
  Search,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { PermissionDefinition } from '@/lib/roles-api';
import { MobileNav } from '@/components/layout/MobileNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const LEVELS: { value: PageLevel; label: string }[] = [
  { value: 'none', label: 'No Access' },
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Read + Write' },
];

function levelLabel(level: PageLevel): string {
  return LEVELS.find((l) => l.value === level)?.label ?? level;
}

interface PermissionCatalogEditorProps {
  title: string;
  subtitle: string;
  /** Current level per page (moduleKey -> level). */
  initialLevels: Record<string, PageLevel>;
  /**
   * Role-default level per page. When provided, each row shows the default and
   * highlights pages that differ (owner overrides). Used on the per-user page.
   */
  roleDefaults?: Record<string, PageLevel>;
  /**
   * The agency-admin capabilities (`agency:*`) available to grant.
   *
   * Optional because only the role editor offers them — they can never be
   * granted per user, which is what `assignableToUser: false` says in the
   * catalog and what `UsersService.updatePermissions` has always enforced.
   */
  adminPermissions?: PermissionDefinition[];
  /** Which of those the role currently holds. */
  initialAdminPermissions?: string[];
  onSave: (levels: PageLevelOverride[], adminPermissions?: string[]) => void;
  saving?: boolean;
  saved?: boolean;
  error?: string | null;
  backTo?: string;
  /** Optional control rendered in the header (e.g. a role selector). */
  headerControl?: React.ReactNode;
  /**
   * When true, the level toggles and Save are disabled and a banner explains
   * why. Used for roles that auto-grant every enabled module, whose access is
   * not controlled by per-page levels.
   */
  readOnly?: boolean;
  /** Message shown in the read-only banner. */
  readOnlyNotice?: string;
}

export function PermissionCatalogEditor({
  title,
  subtitle,
  initialLevels,
  roleDefaults,
  adminPermissions,
  initialAdminPermissions,
  onSave,
  saving = false,
  saved = false,
  error = null,
  backTo = '/settings',
  headerControl,
  readOnly = false,
  readOnlyNotice = 'This role automatically has access to every enabled module. Its access is not controlled by per-page levels.',
}: PermissionCatalogEditorProps) {
  const [levels, setLevels] = useState<Record<string, PageLevel>>({});
  const [admin, setAdmin] = useState<string[]>([]);
  const [query, setQuery] = useState('');

  const seed = useMemo(
    () =>
      PAGES.map((p) => `${p.moduleKey}:${initialLevels[p.moduleKey] ?? 'none'}`).join(
        '|',
      ),
    [initialLevels],
  );

  useEffect(() => {
    const next: Record<string, PageLevel> = {};
    for (const page of PAGES) {
      next[page.moduleKey] = initialLevels[page.moduleKey] ?? 'none';
    }
    setLevels(next);
    // Re-seed only when the underlying values change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const adminSeed = (initialAdminPermissions ?? []).join('|');
  useEffect(() => {
    setAdmin(initialAdminPermissions ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminSeed]);

  const toggleAdmin = (key: string) => {
    setAdmin((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const setLevel = (moduleKey: string, level: PageLevel) => {
    setLevels((prev) => ({ ...prev, [moduleKey]: level }));
  };

  const resetToDefault = (moduleKey: string) => {
    if (!roleDefaults) return;
    setLevel(moduleKey, roleDefaults[moduleKey] ?? 'none');
  };

  const filteredPages = PAGES.filter((page) => {
    if (!query) return true;
    const haystack = `${page.label} ${page.description}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const filteredAdmin = (adminPermissions ?? []).filter((permission) => {
    if (!query) return true;
    const haystack =
      `${permission.label} ${permission.description}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const handleSave = () => {
    const payload: PageLevelOverride[] = PAGES.map((page) => ({
      moduleKey: page.moduleKey,
      level: levels[page.moduleKey] ?? 'none',
    }));
    // `undefined`, not `[]`, when this editor does not offer capabilities —
    // the API reads `[]` as "remove them all", which on the per-user screen
    // would silently strip a role's admin access.
    onSave(payload, adminPermissions ? admin : undefined);
  };

  return (
    <AppShell>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <MobileNav className="-ml-1" />
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
          >
            <Link to={backTo} aria-label="Back">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {title}
            </h1>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {subtitle}
            </p>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-end gap-3">
          {headerControl}
          {saved && !saving && (
            <span className="flex items-center gap-1.5 text-xs text-success">
              <Check className="size-3" /> Saved
            </span>
          )}
          <Button
            type="button"
            variant="brand"
            disabled={saving || readOnly}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6">
        {readOnly && (
          <Alert className="mb-5 border-primary/30 bg-primary/8">
            <Info className="text-primary" />
            <AlertDescription className="text-foreground">
              {readOnlyNotice}
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive" className="mb-5">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="relative mb-6">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              adminPermissions
                ? 'Type to search pages and capabilities…'
                : 'Type to search pages…'
            }
            className="pl-9 bg-card border-border"
          />
        </div>

        {filteredAdmin.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-1 text-sm font-semibold text-foreground">
              Agency administration
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Capabilities rather than pages — they are on or off, and they can
              only be granted through a role, never to one person.
            </p>
            <div className="flex flex-col gap-2">
              {filteredAdmin.map((permission) => (
                <div
                  key={permission.key}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5 sm:px-5"
                >
                  <Checkbox
                    id={`cap-${permission.key}`}
                    checked={admin.includes(permission.key)}
                    disabled={readOnly}
                    onCheckedChange={() => toggleAdmin(permission.key)}
                    className="mt-0.5"
                  />
                  <div className="grid min-w-0 gap-0.5 leading-none">
                    <Label
                      htmlFor={`cap-${permission.key}`}
                      className="cursor-pointer text-sm font-medium"
                    >
                      {permission.label}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {permission.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {filteredAdmin.length > 0 && filteredPages.length > 0 && (
          <h2 className="mb-3 text-sm font-semibold text-foreground">Pages</h2>
        )}

        <div className="flex flex-col gap-2">
          {filteredPages.map((page) => {
            const current = levels[page.moduleKey] ?? 'none';
            const defaultLevel = roleDefaults?.[page.moduleKey];
            const isOverride =
              defaultLevel !== undefined && defaultLevel !== current;

            return (
              <section
                key={page.moduleKey}
                className={cn(
                  // The three-way level switch is ~230px wide and the label
                  // column needs at least as much again — below `sm` they get a
                  // row each rather than both being crushed.
                  'flex flex-col gap-3 rounded-xl border bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5',
                  isOverride ? 'border-primary/35' : 'border-border',
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {page.label}
                    </span>
                    {isOverride && (
                      <Badge
                        size="sm"
                        className="rounded-full border-transparent bg-primary/12 text-primary"
                      >
                        Override
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {page.description}
                  </p>
                  {defaultLevel !== undefined && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Role default: {levelLabel(defaultLevel)}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <div className="flex flex-1 items-center gap-1 rounded-lg bg-muted p-1">
                    {LEVELS.map((option) => {
                      const active = current === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={readOnly}
                          onClick={() => setLevel(page.moduleKey, option.value)}
                          className={cn(
                            'flex-1 rounded-md border px-2.5 py-1.5 text-xs whitespace-nowrap transition-all duration-150 disabled:cursor-not-allowed sm:flex-none sm:px-3',
                            active
                              ? 'border-primary/20 bg-background font-semibold text-primary'
                              : 'border-transparent bg-transparent text-muted-foreground',
                          )}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  {isOverride && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Reset to role default"
                      onClick={() => resetToDefault(page.moduleKey)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <RotateCcw className="size-3.5" />
                    </Button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </AppShell>
  );
}
