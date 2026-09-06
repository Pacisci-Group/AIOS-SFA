import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  clearTokens,
  fetchMe,
  getStoredUser,
  login as apiLogin,
  type AuthUser,
} from '@/lib/api-client';

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  /**
   * Adopt a session established by something other than the login form.
   *
   * Today that is accepting an employee invite (PAC-58): the API returns a full
   * token pair, `invite-api` has already persisted it, and this is what tells
   * React about it so `ProtectedRoute` lets the new user straight in.
   *
   * Takes the user rather than credentials because the caller cannot re-login —
   * it never had a password to replay.
   */
  adoptSession: (user: AuthUser) => void;
  /**
   * Re-read the caller's own permissions from the API.
   *
   * Call after anything that could change them — most obviously an owner
   * editing their own role or permissions, where the UI would otherwise keep
   * offering actions that have started 403ing.
   */
  refreshUser: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());

  /**
   * Keep the in-memory user in step with the server.
   *
   * `initialData` is the stored blob, so there is no unauthenticated flash on
   * boot and `ProtectedRoute` never bounces a signed-in user to the login page
   * while this is in flight. It refetches on window focus, which is what closes
   * the window where an owner changes someone's permissions and that person's
   * open tab keeps rendering the old set until their token refreshes.
   *
   * Disabled when nobody is signed in — `/auth/me` would just 401.
   */
  const { data: me } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchMe,
    enabled: !!user,
    initialData: user ?? undefined,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  useEffect(() => {
    if (me) setUser(me);
  }, [me]);

  const refreshUser = useCallback(async () => {
    const fresh = await queryClient.fetchQuery({
      queryKey: ['auth', 'me'],
      queryFn: fetchMe,
      // Without this, `fetchQuery` serves the cached blob whenever it is
      // younger than the client-wide default staleTime — so a profile edit
      // made within ~30s of the last fetch silently never reached the UI
      // (PAC-81). Every caller of this function has just *changed* something;
      // "fresh enough" is exactly wrong here.
      staleTime: 0,
    });
    setUser(fresh);
  }, [queryClient]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiLogin(email, password);
    setUser(data.user);
  }, []);

  const adoptSession = useCallback(
    (nextUser: AuthUser) => {
      // Drop any cached data belonging to whoever was signed in before. An
      // invite link can be opened on a machine with a live session, and the
      // React Query cache is keyed by resource, not by user — so leftover
      // entries would render the previous user's records to the new one.
      queryClient.clear();
      setUser(nextUser);
    },
    [queryClient],
  );

  const logout = useCallback(() => {
    // Nuke persisted storage (tokens, user, branch) and the in-memory
    // React Query cache so no stale session data survives into the next login.
    clearTokens();
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      login,
      adoptSession,
      refreshUser,
      logout,
    }),
    [user, login, adoptSession, refreshUser, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
