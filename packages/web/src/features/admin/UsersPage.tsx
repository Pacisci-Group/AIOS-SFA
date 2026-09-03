import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Search, Users } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { usePermissions } from '@/hooks/usePermissions';
import { listBranches } from '@/lib/branches-api';
import { listUsers, userStatus, type AgencyUser } from '@/lib/users-api';
import { InviteUserDialog } from './InviteUserDialog';
import { UserCard } from './components/UserCard';
import { UsersTable } from './components/UsersTable';
import { displayName } from './components/user-display';

/** Status order for the directory: who needs attention, then who is here. */
const STATUS_RANK = { invited: 0, active: 1, deactivated: 2 } as const;

/**
 * The agency directory (`/settings/users`).
 *
 * ## What changed in the design pass
 *
 * This page used to render its own copy of the settings header — at
 * `text-sm font-bold`, a type tier that exists nowhere else — inside a
 * `max-w-3xl` column, with a hand-built four-column grid and three labelled
 * ghost buttons on every row. It now uses the shared `SettingsPage` shell at
 * full width and the same table idiom as `/leads`, with the row actions behind
 * one `⋯` (see `UserRowMenu`).
 *
 * Sorting is client-side and so is search: `GET /users` returns the agency's
 * whole roster in one response with no paging, because an agency is tens of
 * people rather than thousands. If that stops being true this is the file that
 * grows a `ListUsersParams`, not the one that adds a second scroll container.
 */
export default function UsersPage() {
  const [query, setQuery] = useState('');
  const { can } = usePermissions();

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers });

  // Same defensive gate the invite dialog uses: the directory needs
  // `agency:users:read`, the branch names need `agency:branches:read`, and
  // nothing says one implies the other. A refusal drops the column.
  const branchesQuery = useQuery({
    queryKey: ['branches'],
    queryFn: listBranches,
    enabled: can('agency:branches:read'),
    retry: false,
  });

  const branchNames = useMemo(
    () =>
      new Map((branchesQuery.data ?? []).map((b) => [b._id, b.name] as const)),
    [branchesQuery.data],
  );

  // Never surface platform/super-admin accounts in the agency directory.
  const roster = useMemo(
    () => (usersQuery.data ?? []).filter((u) => !u.isPlatformAdmin),
    [usersQuery.data],
  );

  const users = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? roster.filter((user: AgencyUser) =>
          [displayName(user), user.email, ...user.roleIds.map((r) => r.name)]
            .join(' ')
            .toLowerCase()
            .includes(q),
        )
      : roster;

    // Pending invites first — they are the rows somebody still has to act on —
    // then alphabetically, which is the only order a directory can be scanned
    // in. The API returns insertion order, which is seed order in practice.
    return [...matches].sort((a, b) => {
      const rank = STATUS_RANK[userStatus(a)] - STATUS_RANK[userStatus(b)];
      if (rank !== 0) return rank;
      return displayName(a).localeCompare(displayName(b));
    });
  }, [roster, query]);

  const showBranch = branchesQuery.isSuccess && branchNames.size > 0;
  const canOpenPermissions = can('agency:roles:read');
  const isPending = usersQuery.isPending;

  return (
    <SettingsPage
      title="Agency Users"
      caption={
        isPending || usersQuery.isError
          ? ' '
          : `${roster.length} ${roster.length === 1 ? 'person' : 'people'}`
      }
      icon={Users}
      width="wide"
      action={
        /* Self-gates on `agency:users:write` and renders nothing without it, so
           a user who can only read the directory sees no invite button. */
        <InviteUserDialog />
      }
    >
      {usersQuery.isError && (
        <Alert variant="destructive" className="mb-5">
          <AlertCircle />
          <AlertDescription>
            {(usersQuery.error as Error).message}
          </AlertDescription>
        </Alert>
      )}

      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email or role…"
          className="border-border bg-card pl-9"
        />
      </div>

      {!isPending && users.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {query.trim()
              ? `Nobody matches “${query.trim()}”.`
              : 'No users yet.'}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop: the table. Below `md` its five columns don't fit. */}
          <div className="hidden md:block">
            <UsersTable
              users={users}
              isPending={isPending}
              branchNames={branchNames}
              showBranch={showBranch}
              canOpenPermissions={canOpenPermissions}
            />
          </div>

          <div className="flex flex-col gap-2 md:hidden">
            {users.map((user) => (
              <UserCard
                key={user._id}
                user={user}
                branchNames={branchNames}
                showBranch={showBranch}
                canOpenPermissions={canOpenPermissions}
              />
            ))}
          </div>
        </>
      )}
    </SettingsPage>
  );
}
