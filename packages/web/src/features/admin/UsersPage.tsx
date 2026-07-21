import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Search, Users } from 'lucide-react';
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
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-slate-300 hover:bg-white/5"
          >
            <Link to="/">
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Users size={16} className="text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-bold">Agency Users</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
              People in your agency
            </p>
          </div>
        </div>
        {!usersQuery.isLoading && (
          <span className="text-xs text-muted-foreground">{totalUsers} users</span>
        )}
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
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
          <div className="rounded-xl overflow-hidden bg-card border border-border">
            <div
              className="grid px-5 py-2.5 gap-3 text-[10px] uppercase tracking-widest text-slate-600 border-b border-border"
              style={{ gridTemplateColumns: '1.4fr 1fr 90px 20px' }}
            >
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
                  'grid px-5 py-3.5 gap-3 items-center transition-colors hover:bg-white/[0.03]',
                  i < users.length - 1 && 'border-b border-border',
                )}
                style={{ gridTemplateColumns: '1.4fr 1fr 90px 20px' }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="bg-blue-900 text-foreground text-xs font-bold">
                      {initials(user)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate font-medium">
                      {displayName(user)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {user.email}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1">
                  {user.roleIds.length ? (
                    user.roleIds.map((role) => (
                      <Badge
                        key={role._id}
                        className="bg-primary/12 text-primary border-transparent rounded-full text-[10px] px-2 py-0.5 font-normal"
                      >
                        {role.name}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-slate-600">No role</span>
                  )}
                </div>

                <Badge
                  className={cn(
                    'rounded-full text-[10px] px-2 py-0.5 w-fit border-transparent font-semibold',
                    user.isActive
                      ? 'bg-emerald-500/12 text-emerald-500'
                      : 'bg-amber-500/15 text-amber-500',
                  )}
                >
                  {user.isActive ? 'Active' : 'Invited'}
                </Badge>

                <ChevronRight size={16} className="text-slate-600 justify-self-end" />
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
