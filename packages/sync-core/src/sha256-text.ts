import { sha256 } from '@noble/hashes/sha2.js';

/** Pure SHA-256 on UTF-8 text; works on Hermes without crypto.subtle. */
export function sha256TextHex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
