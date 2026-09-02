import { useRef } from 'react';
import { Palette, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { DetailCard } from '@/components/common/DetailCard';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useTenant } from '@/contexts/tenant-context';
import {
  BRANDING_ACCEPT,
  BRANDING_MAX_BYTES,
  type AgencyBrandingSettings,
  type BrandingSlot,
} from '@/lib/agency-branding-api';

/**
 * The branding surfaces shared by the settings page and the owner's first-run
 * wizard (PAC-69).
 *
 * Extracted rather than duplicated because the wizard is the *same* three
 * uploads and the *same* preview as `/settings/branding` — only the chrome
 * around them differs. Two copies would diverge the first time a size rule
 * changed, and one of them would be the copy a brand-new owner sees.
 */

/** The three image slots, with the copy explaining what each is for. */
export const BRANDING_SLOTS: {
  slot: BrandingSlot;
  label: string;
  help: string;
  /** Concrete size guidance — see `BrandMark` for where the numbers come from. */
  spec: string;
  has: keyof AgencyBrandingSettings;
}[] = [
  {
    slot: 'logo',
    label: 'Logo',
    help: 'Shown in the sidebar, on the sign-in page, and in every email we send on your behalf.',
    spec: 'Square works best — 256 × 256. It sits next to your agency name, so a wide banner will be scaled down to fit.',
    has: 'hasLogo',
  },
  {
    slot: 'logoDark',
    label: 'Logo (dark theme)',
    help: 'Optional. Upload one if your logo has dark ink — it would otherwise be invisible on the dark sidebar. Without it we use your main logo in both themes.',
    spec: 'Same size as your main logo — 256 × 256.',
    has: 'hasLogoDark',
  },
  {
    slot: 'favicon',
    label: 'Browser tab icon',
    help: 'Shown in the browser tab and in bookmarks.',
    spec: 'Square, 128 × 128. It renders at 16px, so use a simple mark rather than your full logo.',
    has: 'hasFavicon',
  },
];

/**
 * What the branding currently looks like where it matters.
 *
 * Shows the sidebar wordmark **and** the email masthead together, because they
 * are the same uploaded artefact used in two very different places — and the
 * email one is the half an owner cannot otherwise see without inviting someone.
 */
export function BrandPreview() {
  const { branding } = useTenant();

  return (
    <DetailCard title="Preview" icon={Palette}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-sunken p-4">
          <p className="mb-3 text-xs text-muted-foreground">In the app</p>
          <div className="flex items-center gap-2.5">
            {branding.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt={branding.name}
                className="max-h-8 w-auto object-contain"
              />
            ) : (
              <div className="size-8 rounded-md bg-primary" />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{branding.name}</p>
              <p className="text-xs text-muted-foreground uppercase">
                Agency Portal
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-white p-4">
          {/* Pinned light: the email shell is light-only by design, because
              `prefers-color-scheme` support across mail clients is inconsistent
              enough to produce unreadable combinations. See `layout.ts`. */}
          <p className="mb-3 text-xs text-slate-500">In email</p>
          <div className="border-b border-slate-200 pb-3">
            {branding.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt={branding.name}
                className="max-h-8 w-auto object-contain"
              />
            ) : (
              <span className="text-lg font-bold text-[#0033A0]">
                {branding.name}
              </span>
            )}
          </div>
        </div>
      </div>
    </DetailCard>
  );
}

export function ImageSlot({
  label,
  help,
  spec,
  hasImage,
  busy,
  onSelect,
  onRemove,
}: {
  label: string;
  help: string;
  spec: string;
  hasImage: boolean;
  busy: boolean;
  onSelect: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset immediately so re-picking the *same* file after a failed upload
    // still fires a change event.
    e.target.value = '';
    if (!file) return;

    // Checked here as well as server-side: a 2 MB cap enforced only after the
    // bytes have been uploaded wastes the upload and reports the failure late.
    if (file.size > BRANDING_MAX_BYTES) {
      toast.error(
        `That image is ${Math.ceil(file.size / 1024 / 1024)} MB. Keep it under ${
          BRANDING_MAX_BYTES / 1024 / 1024
        } MB.`,
      );
      return;
    }

    onSelect(file);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <Upload size={14} />
            {hasImage ? 'Replace' : 'Upload'}
          </Button>
          {hasImage && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onRemove}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 size={14} />
              Remove
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{help}</p>
      {/* The size is stated up front rather than only in a rejection message —
          the constraints are cheap to meet and expensive to discover after
          uploading a banner that renders as a sliver. */}
      <p className="text-xs text-muted-foreground">
        {spec} PNG or WebP with a transparent background, under{' '}
        {BRANDING_MAX_BYTES / 1024 / 1024} MB.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={BRANDING_ACCEPT}
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}
