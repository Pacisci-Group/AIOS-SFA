import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  clearTokens,
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
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());

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
      logout,
    }),
    [user, login, adoptSession, logout],
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
