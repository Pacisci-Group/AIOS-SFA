import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertCircle, Search, Users } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePermissions } from '@/hooks/usePermissions';
import { listBranches } from '@/lib/branches-api';
import { listUsers } from '@/lib/users-api';
import { InviteUserDialog } from './InviteUserDialog';
import { UserCard } from './components/UserCard';
import { UsersTable } from './components/UsersTable';

/*
 * The status ranking that used to live here — invited, then active, then
 * deactivated — is now the server's `{ deactivatedAt: 1, isActive: 1, … }`
 * sort, which reproduces it exactly because BSON orders Null before Date.
 * Ranking a page in the browser would only ever have sorted that page.
 */

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
 * ## Search and sort are server-side (PAC-101)
 *
 * This docblock used to say the opposite, and named this file as the one that
 * would grow a `ListUsersParams` if the roster ever outgrew a single response.
 * That is what happened — not because an agency got large, but because the
 * filter only covered three of the five rendered columns and could not be made
 * to satisfy the ticket's rule while it ran in the browser.
 *
 * The three pickers that shared this endpoint were moved to
 * `GET /users/options` first, so this page is its only consumer.
 */
/** Matches the API default; the roster is short enough that one page is usual. */
const PAGE_SIZE = 25;

export default function UsersPage() {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const { can } = usePermissions();

  // Debounced so typing four characters is one request, not four — the same
  // 300ms every other server-searched table uses.
  const debouncedQuery = useDebouncedValue(query, 300);

  const params = useMemo(
    () => ({ page, pageSize: PAGE_SIZE, q: debouncedQuery.trim() || undefined }),
    [page, debouncedQuery],
  );

  const usersQuery = useQuery({
    queryKey: ['users', params],
    queryFn: () => listUsers(params),
    // Keeps the current page on screen while the next one loads, so the table
    // doesn't flash empty on every keystroke.
    placeholderData: keepPreviousData,
  });

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

  /*
   * No client-side filter, sort or platform-admin exclusion any more — all
   * three moved to the server (PAC-101). The exclusion in particular had to:
   * a post-fetch filter makes page sizes wrong, dropping rows the server
   * counted.
   */
  const users = usersQuery.data?.items ?? [];
  const total = usersQuery.data?.total ?? 0;
  const totalPages = usersQuery.data?.totalPages ?? 1;

  const showBranch = branchesQuery.isSuccess && branchNames.size > 0;
  const canOpenPermissions = can('agency:roles:read');
  const isPending = usersQuery.isPending;

  return (
    <SettingsPage
      title="Agency Users"
      caption={
        isPending || usersQuery.isError
          ? ' '
          : // `total`, not the page length, or the header lies on every page
            // after the first.
            `${total} ${total === 1 ? 'person' : 'people'}`
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
          onChange={(e) => {
            setQuery(e.target.value);
            // A new query invalidates the page number: page 3 of the old
            // result set is very unlikely to exist in the new one.
            setPage(1);
          }}
          aria-label="Search users"
          placeholder="Search by name, email, role or branch…"
          className="border-border bg-card pl-9"
        />
      </div>

      {!isPending && total === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {/* The **debounced** value, not the raw input: keying off what the
                user is still typing flips the copy before the request that
                would justify it has fired. */}
            {debouncedQuery.trim()
              ? `Nobody matches “${debouncedQuery.trim()}”.`
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

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-sm tabular-nums text-muted-foreground">
                Showing {(page - 1) * PAGE_SIZE + 1} to{' '}
                {Math.min(page * PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || usersQuery.isFetching}
                  onClick={() => setPage(Math.max(1, page - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || usersQuery.isFetching}
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </SettingsPage>
  );
}
