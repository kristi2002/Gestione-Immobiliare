import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api/client';
import type { MeResponse, AuthUser } from '@/types/auth';

export const authKeys = {
  me: ['auth', 'me'] as const,
};

/** Bootstraps session identity. A 401 (logged out) is thrown, not retried. */
export function useMeQuery() {
  return useQuery({
    queryKey: authKeys.me,
    queryFn: ({ signal }) => api.get<MeResponse>('me.php', { signal }),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export interface LoginOkResult {
  status: 'ok';
  user: AuthUser;
  permissions: string[];
  csrf_token: string;
}

export interface LoginRequires2faResult {
  status: 'requires_2fa';
}

export type LoginResult = LoginOkResult | LoginRequires2faResult;

/**
 * Raw fetch — deliberately NOT the shared `api` client. That client treats
 * every 401 as "session expired" and fires the global unauthorized redirect,
 * which would misfire on a plain wrong-password response here and mask the
 * real error message.
 */
async function authRequest<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Impossibile contattare il server.', 0);
  }

  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload || payload.success === false) {
    throw new ApiError(payload?.error ?? `Richiesta non riuscita (${res.status}).`, res.status);
  }
  return payload.data as T;
}

export function login(username: string, password: string) {
  return authRequest<LoginResult>('login.php', { username, password });
}

export function loginVerify2fa(code: string) {
  return authRequest<LoginOkResult>('login_2fa.php', { code });
}
