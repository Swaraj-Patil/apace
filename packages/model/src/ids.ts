const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const LENGTH = 16;
// 248 is the largest multiple of 62 below 256. Dropping bytes at or above it keeps every
// character equally likely.
const UNBIASED_LIMIT = 248;

// Every runtime the model targets (browsers, workers, Node) provides Web Crypto.
const crypto = (
  globalThis as unknown as { crypto: { getRandomValues(array: Uint8Array): Uint8Array } }
).crypto;

/** A random 16-character id over [0-9A-Za-z], about 95 bits. */
export function randomId(): string {
  let id = '';
  const bytes = new Uint8Array(LENGTH * 2);
  while (id.length < LENGTH) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < UNBIASED_LIMIT) id += ALPHABET.charAt(byte % ALPHABET.length);
      if (id.length === LENGTH) break;
    }
  }
  return id;
}
