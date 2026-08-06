import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PAGES,
  type PageLevel,
  type PageLevelOverride,
} from '@sfa/shared';
import { ArrowLeft, Check, RotateCcw, Search } from 'lucide-react';
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
  onSave: (levels: PageLevelOverride[]) => void;
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
  onSave,
  saving = false,
  saved = false,
  error = null,
  backTo = '/',
  headerControl,
  readOnly = false,
  readOnlyNotice = 'This role automatically has access to every enabled module. Its access is not controlled by per-page levels.',
}: PermissionCatalogEditorProps) {
  const [levels, setLevels] = useState<Record<string, PageLevel>>({});
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

  const handleSave = () => {
    const payload: PageLevelOverride[] = PAGES.map((page) => ({
      moduleKey: page.moduleKey,
      level: levels[page.moduleKey] ?? 'none',
    }));
    onSave(payload);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-slate-300 hover:bg-white/5"
          >
            <Link to={backTo}>
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div>
            <h1 className="text-sm font-bold">{title}</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
              {subtitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {headerControl}
          {saved && !saving && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-500">
              <Check size={13} /> Saved
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

      <main className="max-w-3xl mx-auto px-6 py-8">
        {readOnly && (
          <div className="mb-5 px-4 py-3 rounded-lg text-sm bg-sky-400/10 border border-sky-400/25 text-sky-300">
            {readOnlyNotice}
          </div>
        )}

        {error && (
          <div className="mb-5 px-4 py-3 rounded-lg text-sm bg-amber-500/10 border border-amber-500/25 text-amber-500">
            {error}
          </div>
        )}

        <div className="relative mb-6">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to search pages…"
            className="pl-9 bg-card border-border"
          />
        </div>

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
                  'rounded-xl px-5 py-4 flex items-center justify-between gap-4 bg-card border',
                  isOverride ? 'border-primary/35' : 'border-border',
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground font-medium">
                      {page.label}
                    </span>
                    {isOverride && (
                      <Badge className="bg-primary/12 text-sky-300 border-transparent rounded-full text-[10px] px-1.5 py-0.5">
                        Override
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {page.description}
                  </p>
                  {defaultLevel !== undefined && (
                    <p className="text-[10px] text-slate-600 mt-1">
                      Role default: {levelLabel(defaultLevel)}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center gap-1 rounded-lg p-1 bg-gray-900">
                    {LEVELS.map((option) => {
                      const active = current === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={readOnly}
                          onClick={() => setLevel(page.moduleKey, option.value)}
                          className={cn(
                            'px-3 py-1.5 rounded-md text-xs transition-all duration-150 disabled:cursor-not-allowed border',
                            active
                              ? 'bg-muted text-primary border-primary/20 font-semibold'
                              : 'bg-transparent text-muted-foreground border-transparent',
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
                      size="icon"
                      title="Reset to role default"
                      onClick={() => resetToDefault(page.moduleKey)}
                      className="text-muted-foreground hover:text-slate-300 hover:bg-white/5"
                    >
                      <RotateCcw size={14} />
                    </Button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
