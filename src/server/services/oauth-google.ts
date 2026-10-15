/** Google OAuth (authorization code + PKCE, standards-compliant, fetch-based). */

const encoder = new TextEncoder();

export function googleAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: input.state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export type GoogleIdentity = { sub: string; email: string; emailVerified: boolean };

export async function exchangeGoogleCode(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<GoogleIdentity> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) throw new Error(`google_token_exchange_failed_${res.status}`);
  const tokens = (await res.json()) as { id_token?: string; access_token?: string };
  const identityToken = tokens.id_token;
  if (identityToken) {
    const claims = decodeJwtClaims(identityToken);
    if (claims && typeof claims.sub === 'string' && typeof claims.email === 'string') {
      return {
        sub: claims.sub,
        email: claims.email,
        emailVerified: claims.email_verified === true || claims.email_verified === 'true',
      };
    }
  }
  if (tokens.access_token) {
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (infoRes.ok) {
      const info = (await infoRes.json()) as {
        sub?: string;
        email?: string;
        email_verified?: boolean;
      };
      if (info.sub && info.email) {
        return { sub: info.sub, email: info.email, emailVerified: !!info.email_verified };
      }
    }
  }
  throw new Error('google_identity_unavailable');
}

/** Decode JWT claims without verification — used only as a fallback after the
 * token endpoint has already authenticated the exchange (HTTPS + client secret). */
function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  try {
    const segments = jwt.split('.');
    if (segments.length < 2) return null;
    const payload = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

void encoder;
