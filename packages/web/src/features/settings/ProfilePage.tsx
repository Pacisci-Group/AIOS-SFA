import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Bell, KeyRound, Trash2, Upload, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { DataRow, DetailCard } from '@/components/common/DetailCard';
import { UserAvatar } from '@/components/common/UserAvatar';
import { SetPasswordForm } from '@/components/auth/SetPasswordForm';
import { FormError } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';
import { useTenant } from '@/contexts/tenant-context';
import { useAppForm } from '@/hooks/form';
import { ApiError, type AuthUser } from '@/lib/api-client';
import {
  AVATAR_ACCEPT,
  AVATAR_MAX_BYTES,
  changePassword,
  removeAvatar,
  updateMyProfile,
  uploadAvatar,
} from '@/lib/profile-api';
import {
  profileFormSchema,
  toUpdateProfileInput,
  type ProfileFormValues,
} from './profile-schema';
import { SettingsPage } from './SettingsPage';

/**
 * The signed-in user's own profile (PAC-81): photo, name, email (read-only),
 * password, and the read-only account facts.
 *
 * Routed at `/settings/profile` with **no permission gate** — everyone owns
 * their own profile, including a platform admin with no agency. Every mutation
 * here ends with `refreshUser()` (or `adoptSession` for the password), because
 * the sidebar chip renders from the auth context, not from this page — saving
 * a name and watching the old one stay in the sidebar reads as a failed save.
 */
export default function ProfilePage() {
  const { user, refreshUser, adoptSession } = useAuth();
  const { branding } = useTenant();

  // `ProtectedRoute` guarantees a session, but the type is nullable.
  if (!user) return null;

  const displayName = user.name?.trim() || user.email;

  return (
    <SettingsPage
      title="My profile"
      caption="Your account"
      icon={UserRound}
      // Personal, not the workspace's: this page is reached from the sidebar's
      // user chip, so its back arrow goes home rather than into Workspace
      // Settings — which is where the shared shell now points by default.
      backTo="/"
    >
      <div className="space-y-6">
        <PhotoCard
          displayName={displayName}
          avatarUrl={user.avatarUrl}
          onChanged={refreshUser}
        />

        <NameCard
          key={`${user.firstName ?? ''}|${user.lastName ?? ''}`}
          firstName={user.firstName}
          lastName={user.lastName}
          email={user.email}
          onSaved={refreshUser}
        />

        <ChangePasswordCard email={user.email} onChanged={adoptSession} />

        <DetailCard title="Account" icon={UserRound}>
          <div className="grid gap-4 sm:grid-cols-2">
            <DataRow label="Role" value={user.roles.join(', ') || '—'} />
            <DataRow label="Agency" value={branding.name} />
          </div>
        </DetailCard>

        {/* Reserved: notification preferences are a planned sibling feature,
            and the page should already read as the place they will live. */}
        <DetailCard title="Notifications" icon={Bell}>
          <p className="text-sm text-muted-foreground">
            Notification preferences are coming soon.
          </p>
        </DetailCard>
      </div>
    </SettingsPage>
  );
}

/**
 * Upload / replace / remove the profile photo. Modeled on the branding page's
 * `ImageSlot`: hidden file input, client-side type/size mirror of the server
 * rule, and the input reset so re-picking the same file after a failure still
 * fires a change event.
 */
function PhotoCard({
  displayName,
  avatarUrl,
  onChanged,
}: {
  displayName: string;
  avatarUrl: string | null;
  onChanged: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: uploadAvatar,
    onSuccess: async () => {
      await onChanged();
      toast.success('Photo updated');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: removeAvatar,
    onSuccess: async () => {
      await onChanged();
      toast.success('Photo removed');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const busy = upload.isPending || remove.isPending;

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    // Checked here as well as server-side: a cap enforced only after the
    // bytes have been uploaded wastes the upload and reports the failure late.
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error(
        `That image is ${Math.ceil(file.size / 1024 / 1024)} MB. Keep it under ${
          AVATAR_MAX_BYTES / 1024 / 1024
        } MB.`,
      );
      return;
    }

    upload.mutate(file);
  }

  return (
    <DetailCard title="Profile photo" icon={UserRound}>
      <div className="flex flex-wrap items-center gap-4">
        <UserAvatar
          name={displayName}
          avatarUrl={avatarUrl}
          className="size-16"
          fallbackClassName="text-lg font-bold"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="size-4" />
              {avatarUrl ? 'Replace' : 'Upload'}
            </Button>
            {avatarUrl && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => remove.mutate()}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Shown next to your name in the sidebar. Square works best — PNG,
            JPEG or WebP, under {AVATAR_MAX_BYTES / 1024 / 1024} MB.
          </p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ACCEPT}
        className="hidden"
        onChange={handleChange}
      />
    </DetailCard>
  );
}

/**
 * Name form. Keyed by the stored name at the call site, so a save that comes
 * back normalised (trimmed, cleared) re-seeds the fields rather than leaving
 * stale local state that no longer matches the server.
 */
function NameCard({
  firstName,
  lastName,
  email,
  onSaved,
}: {
  firstName: string | null;
  lastName: string | null;
  email: string;
  onSaved: () => Promise<void>;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: updateMyProfile,
    onSuccess: async () => {
      await onSaved();
      toast.success('Profile updated');
    },
    onError: (err) => setSubmitError(errorMessage(err)),
  });

  const form = useAppForm({
    defaultValues: {
      firstName: firstName ?? '',
      lastName: lastName ?? '',
    } satisfies ProfileFormValues,
    validators: { onBlur: profileFormSchema },
    onSubmit: ({ value }) => {
      setSubmitError(null);
      save.mutate(toUpdateProfileInput(value));
    },
  });

  return (
    <DetailCard title="Profile" icon={UserRound}>
      <form.AppForm>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="space-y-4"
          noValidate
        >
          <FormError>{submitError}</FormError>

          <div className="grid gap-4 sm:grid-cols-2">
            <form.AppField name="firstName">
              {(f) => (
                <f.TextField
                  label="First name"
                  autoComplete="given-name"
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>
            <form.AppField name="lastName">
              {(f) => (
                <f.TextField
                  label="Last name"
                  autoComplete="family-name"
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="profile-email" className="text-xs text-muted-foreground">
              Email
            </Label>
            <Input
              id="profile-email"
              type="email"
              value={email}
              disabled
              className="bg-card border-border"
            />
            {/* Visible copy rather than a hover hint — the reason must reach
                keyboard and screen-reader users too. */}
            <p className="text-xs text-muted-foreground">
              Email is how you sign in — it can’t be changed yet.
            </p>
          </div>

          <Button type="submit" variant="brand" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </form.AppForm>
    </DetailCard>
  );
}

function ChangePasswordCard({
  email,
  onChanged,
}: {
  email: string;
  onChanged: (user: AuthUser) => void;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Bumped on success to remount the form — its fields are internal state,
  // and a change-password form still holding the old inputs after "success"
  // reads as if nothing happened.
  const [formEpoch, setFormEpoch] = useState(0);

  async function handleSubmit(password: string, currentPassword?: string) {
    setSubmitError(null);
    try {
      const result = await changePassword(currentPassword ?? '', password);
      // The call persisted the fresh token pair (the change invalidated the
      // old one); this hands the session to React and clears the query cache,
      // exactly like the reset-password flow.
      onChanged(result.user);
      setFormEpoch((n) => n + 1);
      toast.success('Password changed — your other sessions were signed out.');
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : 'Could not change your password. Try again.',
      );
    }
  }

  return (
    <DetailCard title="Change password" icon={KeyRound}>
      <div className="max-w-sm">
        <SetPasswordForm
          key={formEpoch}
          email={email}
          idPrefix="change"
          requireCurrent
          submitLabel="Change password"
          pendingLabel="Changing password…"
          error={submitError}
          onSubmit={handleSubmit}
          footer="Changing your password signs you out everywhere else."
        />
      </div>
    </DetailCard>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError || err instanceof Error
    ? err.message
    : 'Something went wrong.';
}
