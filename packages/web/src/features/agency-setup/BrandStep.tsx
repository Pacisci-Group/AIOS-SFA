import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useTenant } from "@/contexts/tenant-context";
import {
  clearBrandingImage,
  getBranding,
  updateBranding,
  uploadBrandingImage,
  type AgencyBrandingSettings,
  type BrandingSlot,
} from "@/lib/agency-branding-api";
import { ApiError } from "@/lib/api-client";
import {
  BRANDING_SLOTS,
  BrandPreview,
  ImageSlot,
} from "@/features/settings/components/branding-surfaces";

/**
 * The white-label step of the owner's first-run setup (PAC-69 phase 2).
 *
 * Every write here is a real, immediate save against the same endpoints
 * `/settings/branding` uses — nothing is staged until the end. That is
 * deliberate: an owner who abandons the wizard halfway keeps the logo they
 * uploaded, and the preview below shows the actual live state rather than a
 * simulation of it.
 *
 * Colours are not offered, here or in settings: a single owner-picked hex has to
 * stay readable on both the light and the navy dark palette, which is real
 * colour work rather than a form field. See `AgencyBranding`.
 */
export function BrandStep() {
  const queryClient = useQueryClient();
  const { refresh } = useTenant();
  const query = useQuery({ queryKey: ["agency-branding"], queryFn: getBranding });

  const [displayName, setDisplayName] = useState("");
  const [tagline, setTagline] = useState("");

  useEffect(() => {
    if (!query.data) return;
    // Prefilled with the agency's own name rather than left blank: the owner is
    // confirming what they are called, not inventing it from nothing.
    setDisplayName(query.data.displayName ?? query.data.agencyName);
    setTagline(query.data.tagline ?? "");
  }, [query.data]);

  /**
   * Refresh the form's copy **and** the app shell.
   *
   * The second half is easy to forget: the sidebar and the tab title read from
   * `TenantProvider`, which holds the public branding payload and knows nothing
   * about this query. Without it an owner uploads a logo and watches the old
   * mark stay put, which reads as the save having failed.
   */
  function onSaved(next: AgencyBrandingSettings) {
    queryClient.setQueryData(["agency-branding"], next);
    void refresh();
  }

  const saveText = useMutation({
    mutationFn: () =>
      updateBranding({
        displayName: displayName.trim() || null,
        tagline: tagline.trim() || null,
      }),
    onSuccess: (next) => {
      toast.success("Saved");
      onSaved(next);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const upload = useMutation({
    mutationFn: ({ slot, file }: { slot: BrandingSlot; file: File }) =>
      uploadBrandingImage(slot, file),
    onSuccess: (next) => {
      toast.success("Image uploaded");
      onSaved(next);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (slot: BrandingSlot) => clearBrandingImage(slot),
    onSuccess: (next) => {
      toast.success("Image removed");
      onSaved(next);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (query.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }
  if (query.isError) {
    return (
      <p className="text-sm text-destructive">{errorMessage(query.error)}</p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-4 rounded-xl border border-border bg-card p-4 md:p-5">
        <div className="space-y-1.5">
          <Label htmlFor="setup-displayName" className="text-xs">
            What should we call you?
          </Label>
          <Input
            id="setup-displayName"
            value={displayName}
            maxLength={60}
            placeholder={query.data?.agencyName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Shown in the sidebar, on your sign-in page and in every email we send
            on your behalf.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="setup-tagline" className="text-xs">
            Tagline
          </Label>
          <Input
            id="setup-tagline"
            value={tagline}
            maxLength={80}
            placeholder="Operations Platform"
            onChange={(e) => setTagline(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            The small line under your name on the sign-in page. Optional.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saveText.isPending}
          onClick={() => saveText.mutate()}
        >
          {saveText.isPending ? "Saving…" : "Save name"}
        </Button>
      </div>

      <div className="space-y-6 rounded-xl border border-border bg-card p-4 md:p-5">
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

      <BrandPreview />
    </div>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError || err instanceof Error
    ? err.message
    : "Something went wrong.";
}
