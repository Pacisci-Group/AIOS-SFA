import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Search, Users } from 'lucide-react';
import { listUsers, type AgencyUser } from '@/lib/users-api';

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
    <div className="min-h-screen bg-[#0B0F19] text-[#E2E8F0]">
      <header
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="p-2 rounded-lg text-[#64748B] hover:text-[#94A3B8] hover:bg-white/5 transition-all"
          >
            <ArrowLeft size={16} />
          </Link>
          <div className="w-8 h-8 rounded-lg bg-[#38BDF8] flex items-center justify-center">
            <Users size={16} className="text-[#0B0F19]" />
          </div>
          <div>
            <h1 className="text-sm font-bold">Agency Users</h1>
            <p className="text-[10px] text-[#64748B] uppercase tracking-widest">
              People in your agency
            </p>
          </div>
        </div>
        {!usersQuery.isLoading && (
          <span className="text-xs text-[#64748B]">{totalUsers} users</span>
        )}
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {usersQuery.isError && (
          <div
            className="mb-5 px-4 py-3 rounded-lg text-sm"
            style={{
              background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.25)',
              color: '#F59E0B',
            }}
          >
            {(usersQuery.error as Error).message}
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
            placeholder="Search users by name, email or role…"
            className="bg-transparent text-sm text-[#E2E8F0] placeholder:text-[#4B5563] flex-1 outline-none"
          />
        </div>

        {usersQuery.isLoading ? (
          <p className="text-sm text-[#64748B]">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-[#64748B]">No users found.</p>
        ) : (
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: '#161F30', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div
              className="grid px-5 py-2.5 gap-3 text-[10px] uppercase tracking-widest"
              style={{
                gridTemplateColumns: '1.4fr 1fr 90px 20px',
                color: '#4B5563',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}
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
                className="grid px-5 py-3.5 gap-3 items-center transition-colors hover:bg-white/[0.03]"
                style={{
                  gridTemplateColumns: '1.4fr 1fr 90px 20px',
                  borderBottom:
                    i < users.length - 1
                      ? '1px solid rgba(255,255,255,0.04)'
                      : 'none',
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs"
                    style={{ background: '#1A3A8F', color: '#E2E8F0', fontWeight: 700 }}
                  >
                    {initials(user)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-[#E2E8F0] truncate" style={{ fontWeight: 500 }}>
                      {displayName(user)}
                    </p>
                    <p className="text-xs text-[#64748B] truncate">{user.email}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1">
                  {user.roleIds.length ? (
                    user.roleIds.map((role) => (
                      <span
                        key={role._id}
                        className="text-[10px] px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(56,189,248,0.12)', color: '#38BDF8' }}
                      >
                        {role.name}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-[#4B5563]">No role</span>
                  )}
                </div>

                <span
                  className="text-[10px] px-2 py-0.5 rounded-full w-fit"
                  style={{
                    background: user.isActive
                      ? 'rgba(16,185,129,0.12)'
                      : 'rgba(245,158,11,0.15)',
                    color: user.isActive ? '#10B981' : '#F59E0B',
                    fontWeight: 600,
                  }}
                >
                  {user.isActive ? 'Active' : 'Invited'}
                </span>

                <ChevronRight size={16} className="text-[#475569] justify-self-end" />
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
