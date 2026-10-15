/** Sortable unique ids (time-prefixed, worker-safe; no external dependency). */

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford-ish base32

function randomChars(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function newId(prefix: string): string {
  const time = Date.now().toString(32).padStart(9, '0');
  return `${prefix}_${time}${randomChars(12)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
