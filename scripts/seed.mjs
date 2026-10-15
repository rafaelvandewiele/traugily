/**
 * Apply development/demo content seeds via Wrangler D1 (local or remote).
 * Content only — no personal data. Usage: node scripts/seed.mjs --local|--remote
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--remote') ? '--remote' : '--local';
const db = process.env.WRANGLER_DB_NAME ?? 'traugily_db';

const seedDir = join(root, 'seed');
const files = readdirSync(seedDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.log('No seed files found in seed/.');
  process.exit(0);
}

for (const file of files) {
  const sql = readFileSync(join(seedDir, file), 'utf8');
  // Wrap in a transaction; D1 execute handles multi-statement files.
  console.log(`Applying seed ${file} (${mode})…`);
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', db, mode, '--file', join(seedDir, file), '--yes'],
    { stdio: 'inherit', cwd: root },
  );
  void sql;
}

console.log('Seeds applied.');
