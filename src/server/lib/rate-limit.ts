/**
 * Fixed-window rate limiting backed by KV with an in-memory fallback per isolate.
 * KV is appropriate here: counters are short-lived and eventually consistent is fine.
 */

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

type MemEntry = { count: number; windowStart: number };
const memory = new Map<string, MemEntry>();

const WINDOW_MS = 60_000;

export async function checkRateLimit(
  kv: KVNamespace | undefined,
  bucket: string,
  key: string,
  limit: number,
  windowMs = WINDOW_MS,
  now = Date.now(),
): Promise<RateLimitResult> {
  const windowStart = Math.floor(now / windowMs);
  const kvKey = `rl:${bucket}:${key}:${windowStart}`;

  if (kv) {
    try {
      const raw = await kv.get(kvKey);
      const count = raw ? Number(raw) + 1 : 1;
      await kv.put(kvKey, String(count), { expirationTtl: Math.ceil(windowMs / 1000) + 5 });
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds: Math.ceil((windowStart + 1) * windowMs - now) / 1000,
      };
    } catch {
      // fall through to memory on KV errors — never fail open silently without record
    }
  }

  const memKey = `${bucket}:${key}:${windowStart}`;
  const entry = memory.get(memKey) ?? { count: 0, windowStart };
  entry.count += 1;
  memory.set(memKey, entry);
  // opportunistic cleanup
  if (memory.size > 5000) {
    for (const [k, v] of memory) {
      if (v.windowStart < windowStart - 1) memory.delete(k);
    }
  }
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    retryAfterSeconds: Math.ceil(((windowStart + 1) * windowMs - now) / 1000),
  };
}

export const RATE_LIMITS = {
  authLogin: { limit: 10, windowMs: 5 * 60_000 },
  authSignup: { limit: 5, windowMs: 10 * 60_000 },
  passwordReset: { limit: 5, windowMs: 15 * 60_000 },
  reportCreate: { limit: 5, windowMs: 60 * 60_000 },
  aiCall: { limit: 20, windowMs: 60 * 60_000 },
  upload: { limit: 20, windowMs: 60 * 60_000 },
  general: { limit: 600, windowMs: 60_000 },
} as const;
