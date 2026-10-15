/** Secure session + CSRF cookie helpers (HttpOnly session, readable CSRF cookie). */

export const SESSION_COOKIE = 'tg_session';
export const CSRF_COOKIE = 'tg_csrf';
export const OAUTH_STATE_COOKIE = 'tg_oauth';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function buildCookie(
  name: string,
  value: string,
  opts: {
    maxAgeSeconds?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Lax' | 'Strict' | 'None';
    path?: string;
  } = {},
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? '/'}`,
    `SameSite=${opts.sameSite ?? 'Lax'}`,
  ];
  if (opts.maxAgeSeconds != null) parts.push(`Max-Age=${Math.floor(opts.maxAgeSeconds)}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure !== false) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, secure = true): string {
  return buildCookie(name, '', { maxAgeSeconds: 0, secure });
}

export function setSessionCookies(
  sessionToken: string,
  csrfToken: string,
  maxAgeSeconds: number,
  secure: boolean,
): string[] {
  return [
    buildCookie(SESSION_COOKIE, sessionToken, {
      maxAgeSeconds,
      httpOnly: true,
      secure,
      sameSite: 'Lax',
    }),
    buildCookie(CSRF_COOKIE, csrfToken, {
      maxAgeSeconds,
      httpOnly: false, // client must echo it in the X-CSRF-Token header
      secure,
      sameSite: 'Lax',
    }),
  ];
}
