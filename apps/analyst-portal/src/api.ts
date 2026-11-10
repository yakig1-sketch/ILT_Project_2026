// REST client for the gateway (DDD §14): bearer access token, refreshed with the refresh token.
// The analyst portal is for analysts and researchers only (FRS §2, FR-AN-1); it reads the
// /research routes, which answer from the de-identified research views.

const AUTH_KEY = 'ilt.analyst.auth';
const REFRESH_EVERY_MS = 10 * 60_000;
/** Roles that may use the portal. */
export const PORTAL_ROLES = ['ANALYST', 'RESEARCHER'];

export interface AuthUser {
  id: string;
  full_name: string;
  role: string;
  ui_language: string;
}

export interface Auth {
  access_token: string;
  refresh_token: string;
  user: AuthUser;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly messageKey: string,
    readonly code?: string,
  ) {
    super(messageKey);
  }
}

let auth: Auth | null = (() => {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as Auth) : null;
  } catch {
    return null;
  }
})();
const listeners = new Set<() => void>();

function setAuth(next: Auth | null) {
  auth = next;
  try {
    if (next) sessionStorage.setItem(AUTH_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(AUTH_KEY);
  } catch {
    // Kept in memory only.
  }
  listeners.forEach((fn) => fn());
}

export const getAuth = () => auth;
export const onAuthChange = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

async function refresh(): Promise<boolean> {
  if (!auth) return false;
  const res = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: auth.refresh_token }),
  }).catch(() => null);
  if (!res?.ok) return false;
  const { role, ...tokens } = (await res.json()) as Pick<Auth, 'access_token' | 'refresh_token'> & { role?: string };
  // An administrator may have changed the role since sign-in.
  setAuth({ ...auth, ...tokens, user: { ...auth.user, role: role ?? auth.user.role } });
  return true;
}

setInterval(() => void refresh(), REFRESH_EVERY_MS);

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const call = () =>
    fetch(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(auth ? { authorization: `Bearer ${auth.access_token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  let res: Response;
  try {
    res = await call();
    if (res.status === 401 && auth && (await refresh())) res = await call();
  } catch {
    throw new ApiError(0, 'error.network');
  }
  if (res.status === 401 && path !== '/auth/login') setAuth(null);
  const body = (await res.json().catch(() => ({}))) as T & { error?: { code?: string; message_key?: string } };
  if (!res.ok) throw new ApiError(res.status, body.error?.message_key ?? `error.${res.status}`, body.error?.code);
  return body;
}

export async function login(email: string, password: string): Promise<void> {
  const next = await api<Auth>('/auth/login', { method: 'POST', body: { email, password } });
  if (!PORTAL_ROLES.includes(next.user.role)) {
    // Not a portal role: end that sign-in at once.
    await fetch('/api/v1/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${next.access_token}` } }).catch(() => undefined);
    throw new ApiError(403, 'analyst.not_allowed');
  }
  setAuth(next);
}

export async function logout(): Promise<void> {
  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  setAuth(null);
}
