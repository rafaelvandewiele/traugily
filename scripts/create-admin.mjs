/**
 * Bootstrap the first admin account (or promote an existing user).
 * Never hard-codes an email or password: everything comes from CLI flags/env.
 *
 * Usage:
 *   npm run admin:create -- --email admin@example.com --local
 *   npm run admin:create -- --email admin@example.com --remote
 *
 * If the user does not exist, a random password is generated and printed ONCE.
 * If the user exists, their role is promoted without touching the password.
 */

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const email = args.find((a, i) => args[i - 1] === '--email') ?? process.env.ADMIN_EMAIL;
const mode = args.includes('--remote') ? '--remote' : '--local';
const env = args.includes('--remote') ? '--env production' : '';
const db = args.includes('--remote')
  ? (process.env.WRANGLER_DB_NAME ?? 'DB')
  : (process.env.WRANGLER_DB_NAME ?? 'traugily_db');

if (!email || !email.includes('@')) {
  console.error('Usage: npm run admin:create -- --email <address> [--remote]');
  process.exit(1);
}

const normalized = email.trim().toLowerCase();
const now = new Date().toISOString();
const password = randomBytes(12).toString('base64url') + 'A1';
const salt = randomBytes(16).toString('base64');
// Must match PBKDF2_ITERATIONS in src/server/lib/crypto.ts and stay ≤100000
// (the Cloudflare Workers Web Crypto cap).
const iterations = 100000;

// Compute PBKDF2 hash with Node WebCrypto (same format as the Worker).
const { subtle } = globalThis.crypto;
const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
  'deriveBits',
]);
const bits = await subtle.deriveBits(
  { name: 'PBKDF2', salt: Buffer.from(salt, 'base64'), iterations, hash: 'SHA-256' },
  key,
  256,
);
const hashB64 = Buffer.from(bits).toString('base64');
const stored = `pbkdf2$pbkdf2-sha256$${iterations}$${salt}$${hashB64}`;

const id = `usr_bootstrap_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;

// Idempotent SQL: promote if exists, otherwise insert then promote.
const sql = `
INSERT INTO users (id, email, email_normalized, password_hash, password_algo, status, locale, is_admin, created_at, updated_at)
VALUES ('${id}', '${normalized}', '${normalized}', '${stored.replace(/'/g, "''")}', 'pbkdf2-sha256', 'active', 'en', 1, '${now}', '${now}')
ON CONFLICT(email_normalized) DO UPDATE SET is_admin = 1, updated_at = '${now}';

INSERT OR IGNORE INTO auth_identities (id, user_id, provider, provider_user_id, created_at)
VALUES ('ide_${id}', COALESCE((SELECT id FROM users WHERE email_normalized = '${normalized}'), '${id}'), 'email', '${normalized}', '${now}');

INSERT OR IGNORE INTO entitlements (user_id, plan, status, source, updated_at)
VALUES (COALESCE((SELECT id FROM users WHERE email_normalized = '${normalized}'), '${id}'), 'free', 'free', 'admin_bootstrap', '${now}');

INSERT OR IGNORE INTO profiles (user_id, unit_system, created_at, updated_at)
VALUES (COALESCE((SELECT id FROM users WHERE email_normalized = '${normalized}'), '${id}'), 'metric', '${now}', '${now}');
`;

const tmp = join(root, `admin-bootstrap-${Date.now()}.sql`);
writeFileSync(tmp, sql);
try {
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', db, mode, ...(env ? env.split(' ') : []), '--file', tmp, '--yes'],
    {
      stdio: 'inherit',
      cwd: root,
    },
  );
  console.log(`\nAdmin ready: ${normalized}`);
  console.log(`Temporary password (shown once, store it safely): ${password}`);
  console.log('The user must reset this password after first sign-in.');
} finally {
  rmSync(tmp, { force: true });
}
