import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PAGES,
  type PageLevel,
  type PageLevelOverride,
} from '@sfa/shared';
import { ArrowLeft, Check, RotateCcw, Search } from 'lucide-react';

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
    <div className="min-h-screen bg-[#0B0F19] text-[#E2E8F0]">
      <header
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-3">
          <Link
            to={backTo}
            className="p-2 rounded-lg text-[#64748B] hover:text-[#94A3B8] hover:bg-white/5 transition-all"
          >
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h1 className="text-sm font-bold">{title}</h1>
            <p className="text-[10px] text-[#64748B] uppercase tracking-widest">
              {subtitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {headerControl}
          {saved && !saving && (
            <span className="flex items-center gap-1.5 text-xs text-[#10B981]">
              <Check size={13} /> Saved
            </span>
          )}
          <button
            type="button"
            disabled={saving || readOnly}
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all hover:brightness-110 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, #38BDF8, #0EA5E9)',
              color: '#0B0F19',
              fontWeight: 600,
            }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {readOnly && (
          <div
            className="mb-5 px-4 py-3 rounded-lg text-sm"
            style={{
              background: 'rgba(56,189,248,0.1)',
              border: '1px solid rgba(56,189,248,0.25)',
              color: '#7DD3FC',
            }}
          >
            {readOnlyNotice}
          </div>
        )}

        {error && (
          <div
            className="mb-5 px-4 py-3 rounded-lg text-sm"
            style={{
              background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.25)',
              color: '#F59E0B',
            }}
          >
            {error}
          </div>
        )}

        <div
          className="flex items-center gap-2 px-3 py-2.5 rounded-lg mb-6"
          style={{ background: '#161F30', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <Search size={15} className="text-[#64748B] shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to search pages…"
            className="bg-transparent text-sm text-[#E2E8F0] placeholder:text-[#4B5563] flex-1 outline-none"
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
                className="rounded-xl px-5 py-4 flex items-center justify-between gap-4"
                style={{
                  background: '#161F30',
                  border: isOverride
                    ? '1px solid rgba(56,189,248,0.35)'
                    : '1px solid rgba(255,255,255,0.07)',
                }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-sm text-[#E2E8F0]"
                      style={{ fontWeight: 500 }}
                    >
                      {page.label}
                    </span>
                    {isOverride && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{
                          background: 'rgba(56,189,248,0.12)',
                          color: '#7DD3FC',
                        }}
                      >
                        Override
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#64748B] mt-0.5">{page.description}</p>
                  {defaultLevel !== undefined && (
                    <p className="text-[10px] text-[#4B5563] mt-1">
                      Role default: {levelLabel(defaultLevel)}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div
                    className="flex items-center gap-1 rounded-lg p-1"
                    style={{ background: '#111827' }}
                  >
                    {LEVELS.map((option) => {
                      const active = current === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={readOnly}
                          onClick={() => setLevel(page.moduleKey, option.value)}
                          className="px-3 py-1.5 rounded-md text-xs transition-all duration-150 disabled:cursor-not-allowed"
                          style={{
                            background: active ? '#1E2B44' : 'transparent',
                            color: active ? '#38BDF8' : '#64748B',
                            fontWeight: active ? 600 : 400,
                            border: active
                              ? '1px solid rgba(56,189,248,0.2)'
                              : '1px solid transparent',
                          }}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  {isOverride && (
                    <button
                      type="button"
                      title="Reset to role default"
                      onClick={() => resetToDefault(page.moduleKey)}
                      className="p-2 rounded-lg text-[#64748B] hover:text-[#94A3B8] hover:bg-white/5 transition-all"
                    >
                      <RotateCcw size={14} />
                    </button>
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
