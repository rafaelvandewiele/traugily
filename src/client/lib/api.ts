/** Typed API client: session cookies + CSRF header + consistent error handling. */

import type { ApiErrorBody } from '../../shared/contracts';

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
    public details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export type ApiOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCookie('tg_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch {
    throw new ApiClientError(
      0,
      'network_error',
      'We could not reach the server. Check your connection and try again.',
    );
  }

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ApiClientError(
      res.status,
      body?.error?.code ?? 'request_failed',
      body?.error?.message ?? 'Something went wrong. Please try again.',
      body?.error?.field,
      body?.error?.details,
    );
  }
  return payload as T;
}
