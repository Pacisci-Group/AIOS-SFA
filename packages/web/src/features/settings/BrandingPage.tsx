import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Palette, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { DetailCard } from '@/components/common/DetailCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useTenant } from '@/contexts/tenant-context';
import {
  clearBrandingImage,
  getBranding,
  updateBranding,
  uploadBrandingImage,
  type AgencyBrandingSettings,
  type BrandingSlot,
} from '@/lib/agency-branding-api';
import { ApiError } from '@/lib/api-client';
import {
  BRANDING_SLOTS,
  BrandPreview,
  ImageSlot,
} from './components/branding-surfaces';
import { SettingsPage } from './SettingsPage';

export default function BrandingPage() {
  const queryClient = useQueryClient();
  const { refresh } = useTenant();
  const query = useQuery({ queryKey: ['agency-branding'], queryFn: getBranding });

  const [displayName, setDisplayName] = useState('');
  const [tagline, setTagline] = useState('');

  // Seed the inputs once the settings land. Keyed on the fetched values rather
  // than running on mount, because the query resolves after the first render.
  useEffect(() => {
    if (!query.data) return;
    setDisplayName(query.data.displayName ?? '');
    setTagline(query.data.tagline ?? '');
  }, [query.data]);

  /**
   * Refresh both the form and the app shell.
   *
   * The second half is the part that is easy to forget: the sidebar and tab
   * title read from `TenantProvider`, which holds the *public* branding payload
   * and knows nothing about this page's query. Without refreshing it, an owner
   * uploads a logo and watches the old one stay in the sidebar — which reads as
   * the save having failed.
   *
   * The image itself turns over because the API versions the URL by a hash of
   * the object key, and every upload mints a new key.
   */
  function onSaved(next: AgencyBrandingSettings) {
    queryClient.setQueryData(['agency-branding'], next);
    void refresh();
  }

  const saveText = useMutation({
    mutationFn: () =>
      updateBranding({
        // Empty means "clear it", which the API distinguishes from "not sent".
        displayName: displayName.trim() || null,
        tagline: tagline.trim() || null,
      }),
    onSuccess: (next) => {
      toast.success('Branding updated');
      onSaved(next);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const upload = useMutation({
    mutationFn: ({ slot, file }: { slot: BrandingSlot; file: File }) =>
      uploadBrandingImage(slot, file),
    onSuccess: (next) => {
      toast.success('Image uploaded');
      onSaved(next);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (slot: BrandingSlot) => clearBrandingImage(slot),
    onSuccess: (next) => {
      toast.success('Image removed');
      onSaved(next);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <SettingsPage
      title="Branding"
      caption="How your agency appears"
      icon={Palette}
    >
      {query.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : query.isError ? (
        <p className="text-sm text-destructive">
          {errorMessage(query.error)}
        </p>
      ) : (
        <div className="space-y-6">
          <BrandPreview />

          <DetailCard title="Name" icon={Palette}>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="displayName" className="text-xs">
                  Display name
                </Label>
                <Input
                  id="displayName"
                  value={displayName}
                  maxLength={60}
                  placeholder={query.data?.agencyName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to use your agency name,{' '}
                  {query.data?.agencyName}.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tagline" className="text-xs">
                  Tagline
                </Label>
                <Input
                  id="tagline"
                  value={tagline}
                  maxLength={80}
                  placeholder="Operations Platform"
                  onChange={(e) => setTagline(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The small line under your name on the sign-in page.
                </p>
              </div>

              <Button
                variant="brand"
                disabled={saveText.isPending}
                onClick={() => saveText.mutate()}
              >
                {saveText.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </DetailCard>

          <DetailCard title="Images" icon={Upload}>
            <div className="space-y-6">
              {BRANDING_SLOTS.map(({ slot, label, help, spec, has }) => (
                <ImageSlot
                  key={slot}
                  label={label}
                  help={help}
                  spec={spec}
                  hasImage={Boolean(query.data?.[has])}
                  busy={upload.isPending || remove.isPending}
                  onSelect={(file) => upload.mutate({ slot, file })}
                  onRemove={() => remove.mutate(slot)}
                />
              ))}
            </div>
          </DetailCard>
        </div>
      )}
    </SettingsPage>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError || err instanceof Error
    ? err.message
    : 'Something went wrong.';
}
