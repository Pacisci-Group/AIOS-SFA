const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getAccessToken(): string | null {
  return localStorage.getItem('accessToken');
}

export function getRefreshToken(): string | null {
  return localStorage.getItem('refreshToken');
}

export function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', refreshToken);
}

/**
 * Device preferences that survive logout.
 *
 * Everything else in `localStorage` is session-derived and must not — see
 * {@link clearTokens}. These are the opposite: they describe the *browser*, not
 * the person signed into it, they contain nothing about the account, and
 * resetting them is a bug rather than a safeguard. Logging out used to repaint
 * the app dark for anyone who had chosen the light theme.
 *
 * Keep this list short, and only add a key when leaking it to the next user of
 * the same machine would be harmless.
 */
const PRESERVED_UI_PREFERENCE_KEYS = ['theme', 'sidebar:collapsed'] as const;

/**
 * Key prefixes preserved alongside {@link PRESERVED_UI_PREFERENCE_KEYS}, for
 * entries whose exact key is not known ahead of time.
 *
 * Today: the white-label branding cache, keyed `tenant:<host>`. It describes
 * the **host**, not the person signed into it — it holds an agency's public
 * name and logo URL, which is exactly what the next visitor to that address
 * sees on the login page anyway. Wiping it on logout would make the very next
 * paint flash "AgencyOps" at someone who has never seen that name.
 */
const PRESERVED_UI_PREFERENCE_PREFIXES = ['tenant:'] as const;

/**
 * Wipe every trace of the session from the browser. Clears the whole
 * localStorage and sessionStorage rather than individual keys so no cached
 * data (tokens, user, branch selection, or anything added later) can leak
 * into the next session — then restores the handful of device preferences in
 * {@link PRESERVED_UI_PREFERENCE_KEYS}.
 *
 * Deliberately still a clear-then-restore rather than a list of keys to remove:
 * the default for anything new stays "wiped", which is the safe direction.
 */
export function clearTokens() {
  try {
    const prefixed = Object.keys(localStorage).filter((key) =>
      PRESERVED_UI_PREFERENCE_PREFIXES.some((prefix) => key.startsWith(prefix)),
    );
    const preserved = [...PRESERVED_UI_PREFERENCE_KEYS, ...prefixed].map(
      (key) => [key, localStorage.getItem(key)] as const,
    );

    localStorage.clear();
    sessionStorage.clear();

    for (const [key, value] of preserved) {
      if (value !== null) localStorage.setItem(key, value);
    }
  } catch {
    // Storage may be unavailable (private mode / SSR); ignore.
  }
}

export interface AuthUser {
  id: string;
  email: string;
  /** Full name from firstName/lastName, or null if not set. */
  name: string | null;
  /** Human-readable role names (e.g. ["Owner"]). For display only. */
  roles: string[];
  agencyId: string | null;
  branchId: string | null;
  permissions: string[];
  scope: string;
  dataScope: string;
  isPlatformAdmin: boolean;
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setStoredUser(user: AuthUser) {
  localStorage.setItem('user', JSON.stringify(user));
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    clearTokens();
    return null;
  }

  const data = (await res.json()) as {
    accessToken: string;
    refreshToken: string;
    user: AuthUser;
  };
  setTokens(data.accessToken, data.refreshToken);
  setStoredUser(data.user);
  return data.accessToken;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  let token = getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const branchId = localStorage.getItem('branchId');
  if (branchId) {
    headers.set('X-Branch-Id', branchId);
  }

  let res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401 && getRefreshToken()) {
    token = await refreshAccessToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
      res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    }
  }

  if (!res.ok) {
    const text = await res.text();
    let message = text || res.statusText;
    try {
      const json = JSON.parse(text) as { message?: string | string[] };
      if (json.message) {
        message = Array.isArray(json.message) ? json.message.join(', ') : json.message;
      }
    } catch {
      // use raw text
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

/**
 * Fetch for `@Public()` API routes. No `Authorization`, no `X-Branch-Id`, and
 * no 401-refresh — same `ApiError` contract otherwise.
 *
 * Deliberately not `apiFetch`. A producer previewing their own share link is a
 * completely ordinary thing to do, and if their access token happens to be
 * expired, `apiFetch` would attempt a refresh, fail it, and call
 * `clearTokens()` — which wipes localStorage and **logs them out of the app for
 * opening their own link**. Precedent: `uploadToPresignedUrl` in
 * `deal-audits-api.ts` bypasses `apiFetch` for the same class of reason.
 */
export async function publicFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const text = await res.text();
    let message = text || res.statusText;
    try {
      const json = JSON.parse(text) as { message?: string | string[] };
      if (json.message) {
        message = Array.isArray(json.message) ? json.message.join(', ') : json.message;
      }
    } catch {
      // use raw text
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export async function login(email: string, password: string) {
  const data = await apiFetch<{
    accessToken: string;
    refreshToken: string;
    user: AuthUser;
  }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  setTokens(data.accessToken, data.refreshToken);
  setStoredUser(data.user);
  return data;
}

export { API_BASE };

/**
 * The caller's identity and *current* permissions, straight from the API.
 *
 * The stored `user` blob is only rewritten at login, token refresh and
 * accept-invite, so without this a permission change did not reach a signed-in
 * browser until the access token refreshed — the API enforced it immediately
 * while the UI kept offering actions that had started 403ing.
 *
 * Re-stores the blob so a reload picks up the fresh set too.
 */
export async function fetchMe(): Promise<AuthUser> {
  const user = await apiFetch<AuthUser>('/auth/me');
  setStoredUser(user);
  return user;
}
