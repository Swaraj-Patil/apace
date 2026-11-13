// A streaming 64-bit content hash: two cyrb53-style lanes. It's fast and gives the same answer
// in Node, browsers and workers. It isn't cryptographic, and doesn't need to be: it only tells
// whether generated output changed.

// Every runtime the seed runs in (browsers, workers and Node) provides TextEncoder.
const encoder = new (
  globalThis as unknown as { TextEncoder: new () => { encode(text: string): Uint8Array } }
).TextEncoder();

/** The text's UTF-8 bytes. */
export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export interface Hasher {
  update(bytes: Uint8Array): void;
  updateText(text: string): void;
  /** 16 hex characters. */
  digest(): string;
}

export function createHasher(): Hasher {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const update = (bytes: Uint8Array) => {
    for (const byte of bytes) {
      h1 = Math.imul(h1 ^ byte, 2654435761);
      h2 = Math.imul(h2 ^ byte, 1597334677);
    }
  };
  return {
    update,
    updateText: (text) => update(utf8(text)),
    digest() {
      let a = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      let b = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      a >>>= 0;
      b >>>= 0;
      return b.toString(16).padStart(8, '0') + a.toString(16).padStart(8, '0');
    },
  };
}
