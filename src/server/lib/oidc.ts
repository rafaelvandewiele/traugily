/** Apple identity-token (RS256 JWT) verification against Apple's JWKS — Web Crypto only. */

import { fromB64url } from './crypto';

const encoder = new TextEncoder();

export async function verifyAppleIdToken(
  idToken: string,
  clientId: string,
  jwksFetcher: (url: string) => Promise<{
    keys: Array<{ kid: string; kty: string; n: string; e: string }>;
  }>,
): Promise<{ ok: true; claims: Record<string, unknown> } | { ok: false; reason: string }> {
  const segments = idToken.split('.');
  if (segments.length !== 3) return { ok: false, reason: 'malformed_jwt' };
  const [hB64, pB64, sB64] = segments;
  const header = JSON.parse(new TextDecoder().decode(fromB64url(hB64))) as {
    kid?: string;
    alg?: string;
  };
  if (header.alg !== 'RS256' || !header.kid) return { ok: false, reason: 'unsupported_alg' };
  const jwks = await jwksFetcher('https://appleid.apple.com/auth/keys');
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'unknown_kid' };
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const data = encoder.encode(`${hB64}.${pB64}`);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(sB64), data);
  if (!valid) return { ok: false, reason: 'bad_signature' };
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(pB64))) as Record<string, unknown>;
  if (claims.iss !== 'https://appleid.apple.com') return { ok: false, reason: 'bad_issuer' };
  const aud = claims.aud;
  const audienceOk = aud === clientId || (Array.isArray(aud) && aud.includes(clientId));
  if (!audienceOk) return { ok: false, reason: 'bad_audience' };
  const exp = Number(claims.exp);
  if (Number.isFinite(exp) && exp < Math.floor(Date.now() / 1000))
    return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}
