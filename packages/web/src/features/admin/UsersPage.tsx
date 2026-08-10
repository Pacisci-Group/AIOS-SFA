import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Search, Users } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { MobileNav } from '@/components/layout/MobileNav';
import { listUsers, type AgencyUser } from '@/lib/users-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

function displayName(user: AgencyUser): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  return user.email.split('@')[0] ?? user.email;
}

function initials(user: AgencyUser): string {
  const full = [user.firstName, user.lastName].filter(Boolean);
  if (full.length) {
    return full.map((p) => p!.charAt(0).toUpperCase()).join('').slice(0, 2);
  }
  return (user.email.slice(0, 2) || 'U').toUpperCase();
}

export default function UsersPage() {
  const [query, setQuery] = useState('');
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers });

  const users = useMemo(() => {
    // Never surface platform/super-admin accounts in the agency directory.
    const list = (usersQuery.data ?? []).filter((u) => !u.isPlatformAdmin);
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((u) =>
      [displayName(u), u.email, ...u.roleIds.map((r) => r.name)]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [usersQuery.data, query]);

  const totalUsers = useMemo(
    () => (usersQuery.data ?? []).filter((u) => !u.isPlatformAdmin).length,
    [usersQuery.data],
  );

  return (
    <AppShell>
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <MobileNav className="-ml-1" />
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
          >
            <Link to="/" aria-label="Back">
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-primary sm:flex">
            <Users size={16} className="text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold">Agency Users</h1>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              People in your agency
            </p>
          </div>
        </div>
        {!usersQuery.isLoading && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {totalUsers} users
          </span>
        )}
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6">
        {usersQuery.isError && (
          <div className="mb-5 px-4 py-3 rounded-lg text-sm bg-amber-500/10 border border-amber-500/25 text-amber-500">
            {(usersQuery.error as Error).message}
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
            placeholder="Search users by name, email or role…"
            className="pl-9 bg-card border-border"
          />
        </div>

        {usersQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users found.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {/* The four-column table only exists from `md` up; below that each
                row stacks into a card, so its header would label nothing. */}
            <div className="hidden grid-cols-[1.4fr_1fr_90px_20px] gap-3 border-b border-border px-5 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase md:grid">
              <span>User</span>
              <span>Roles</span>
              <span>Status</span>
              <span />
            </div>

            {users.map((user, i) => (
              <Link
                key={user._id}
                to={`/settings/users/${user._id}/permissions`}
                className={cn(
                  'flex flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-muted/50 md:grid md:grid-cols-[1.4fr_1fr_90px_20px] md:items-center md:gap-3 md:px-5',
                  i < users.length - 1 && 'border-b border-border',
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-sidebar-accent text-xs font-bold text-sidebar-accent-foreground dark:bg-blue-900 dark:text-foreground">
                      {initials(user)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {displayName(user)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                  <ChevronRight
                    size={16}
                    className="ml-auto shrink-0 text-muted-foreground md:hidden"
                  />
                </div>

                {/* `md:contents` dissolves this wrapper into the grid, so the
                    same two nodes are one wrapped line on a phone and columns
                    2 and 3 of the table on a desktop — no duplicate markup. */}
                <div className="flex flex-wrap items-center gap-1.5 md:contents">
                  <div className="flex flex-wrap gap-1">
                    {user.roleIds.length ? (
                      user.roleIds.map((role) => (
                        <Badge
                          key={role._id}
                          size="sm"
                          className="rounded-full border-transparent bg-primary/12 font-normal text-primary"
                        >
                          {role.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No role
                      </span>
                    )}
                  </div>

                  <Badge
                    size="sm"
                    className={cn(
                      'w-fit rounded-full border-transparent font-semibold',
                      user.isActive
                        ? 'bg-success/12 text-success'
                        : 'bg-destructive/15 text-destructive',
                    )}
                  >
                    {user.isActive ? 'Active' : 'Invited'}
                  </Badge>
                </div>

                <ChevronRight
                  size={16}
                  className="hidden justify-self-end text-muted-foreground md:block"
                />
              </Link>
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}
