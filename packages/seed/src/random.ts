// Seedable randomness. Every stream is keyed by the seed and a path of labels, so each part
// of the workspace draws from its own stream, and one part can be regenerated without the rest.

export interface Random {
  /** A float in [0, 1). */
  next(): number;
  /** An unsigned 32-bit integer. */
  uint32(): number;
  /** An integer in [min, max]. */
  int(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** One of the values, chosen in proportion to its weight. */
  weighted<T>(choices: readonly (readonly [T, number])[]): T;
  /** A normally distributed value. */
  normal(mean: number, deviation: number): number;
}

/** Four 32-bit words from a string (cyrb128), used to seed sfc32. */
function cyrb128(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** A stream of the sfc32 generator, keyed by `seed` and `path`. */
export function stream(seed: number, ...path: readonly (string | number)[]): Random {
  let [a, b, c, d] = cyrb128(`${seed}/${path.join('/')}`);
  const uint32 = (): number => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  // Discard a few outputs so similar keys don't start out correlated.
  for (let i = 0; i < 12; i++) uint32();
  const next = () => uint32() / 4294967296;

  return {
    next,
    uint32,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('Cannot pick from an empty list');
      return items[Math.floor(next() * items.length)] as T;
    },
    weighted<T>(choices: readonly (readonly [T, number])[]): T {
      const total = choices.reduce((sum, [, weight]) => sum + weight, 0);
      let point = next() * total;
      for (const [value, weight] of choices) {
        point -= weight;
        if (point < 0) return value;
      }
      const last = choices.at(-1);
      if (last === undefined) throw new Error('Cannot choose from an empty list');
      return last[0];
    },
    normal(mean, deviation) {
      // Box-Muller, keeping away from log(0).
      const u = 1 - next();
      const v = next();
      return mean + deviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

const ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A random-looking id of [0-9A-Za-z], drawn from the stream. */
export function idFrom(random: Random, length: number): string {
  let id = '';
  for (let i = 0; i < length; i++) id += ID_ALPHABET.charAt(Math.floor(random.next() * 62));
  return id;
}
