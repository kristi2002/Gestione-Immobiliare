/**
 * Typed HTTP client for the PHP JSON API.
 *
 * Contract with the backend (see config/api_helpers.php):
 *   success → { success: true,  data: <T> }
 *   failure → { success: false, error: <string> }   with an HTTP error code
 *
 * Responsibilities:
 *  - same-origin session auth (`credentials: 'include'` → gestionale_session cookie)
 *  - CSRF: attach X-CSRF-TOKEN on every mutating request
 *  - unwrap the envelope so callers get `<T>` directly
 *  - normalize errors into a single ApiError type
 *  - surface 401 (session expired) through a subscribable handler
 */

const API_BASE = '/api';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// --- CSRF token, hydrated once by the auth bootstrap (GET /api/me) ----------
let csrfToken: string | null = null;
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

// --- 401 handler: the auth layer registers a redirect-to-login callback -----
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  /** Query params appended to the URL (undefined/null values are skipped). */
  params?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const url = buildUrl(path, options.params);

  const headers: Record<string, string> = { Accept: 'application/json' };
  const isMutation = method !== 'GET';

  if (isMutation) {
    headers['Content-Type'] = 'application/json';
    if (csrfToken) headers['X-CSRF-TOKEN'] = csrfToken;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: options.signal,
    });
  } catch {
    throw new ApiError('Impossibile contattare il server.', 0);
  }

  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError('Sessione scaduta. Effettua di nuovo il login.', 401);
  }

  const payload = await parseJson(res);

  if (!res.ok || (payload && payload.success === false)) {
    const message =
      (payload && (payload.error as string)) ||
      `Richiesta non riuscita (${res.status}).`;
    throw new ApiError(message, res.status);
  }

  // Unwrap { success, data }. Some endpoints (downloads) may not use it.
  return (payload && 'data' in payload ? payload.data : payload) as T;
}

function buildUrl(path: string, params?: RequestOptions['params']): string {
  const base = path.startsWith('/api/') || path.startsWith('http')
    ? path
    : `${API_BASE}/${path.replace(/^\//, '')}`;
  if (!params) return base;

  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) usp.append(key, String(value));
  }
  const qs = usp.toString();
  return qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base;
}

async function parseJson(res: Response): Promise<{ success?: boolean; data?: unknown; error?: unknown } | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Non-JSON body (e.g. PHP fatal leaking HTML) — treat as opaque failure.
    return { success: false, error: 'Risposta del server non valida.' };
  }
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, body, options),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, undefined, options),
};
