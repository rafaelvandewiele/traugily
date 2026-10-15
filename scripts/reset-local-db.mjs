/** Reset local D1 state (used by the e2e setup for a deterministic database). */

import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = join(root, '.wrangler', 'state');

if (existsSync(stateDir)) {
  rmSync(stateDir, { recursive: true, force: true });
  console.log('Removed local Wrangler state.');
} else {
  console.log('No local Wrangler state to remove.');
}
