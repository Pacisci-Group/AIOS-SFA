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
 * Wipe every trace of the session from the browser. Clears the whole
 * localStorage and sessionStorage rather than individual keys so no cached
 * data (tokens, user, branch selection, or anything added later) can leak
 * into the next session.
 */
export function clearTokens() {
  try {
    localStorage.clear();
    sessionStorage.clear();
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
