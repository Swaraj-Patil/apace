// Small generated images, so seeded pages show pictures without touching the network.
import { createHasher, utf8 } from './hash.ts';
import { stream } from './random.ts';

export interface SeedAsset {
  /** Content-addressed: the same bytes always get the same id. */
  readonly id: string;
  readonly kind: 'image' | 'cover';
  readonly mime: 'image/svg+xml';
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

export const IMAGE_ASSETS = 20;
export const COVER_ASSETS = 4;

const IMAGE_SIZES = [
  [640, 360],
  [800, 450],
  [480, 480],
  [720, 540],
] as const;

export function seedAssets(seed: number): SeedAsset[] {
  const assets: SeedAsset[] = [];
  for (let n = 0; n < IMAGE_ASSETS + COVER_ASSETS; n++) {
    const random = stream(seed, 'asset', n);
    const kind = n < IMAGE_ASSETS ? 'image' : 'cover';
    const [width, height] = kind === 'cover' ? [1600, 400] : random.pick(IMAGE_SIZES);
    const color = () => `#${random.int(0, 0xffffff).toString(16).padStart(6, '0')}`;
    const circles = Array.from({ length: random.int(3, 7) }, () => {
      const radius = random.int(20, Math.floor(Math.min(width, height) / 2));
      return `<circle cx="${random.int(0, width)}" cy="${random.int(0, height)}" r="${radius}" fill="${color()}" fill-opacity="0.6"/>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${color()}"/>${circles}</svg>`;
    const bytes = utf8(svg);
    const hasher = createHasher();
    hasher.update(bytes);
    assets.push({
      id: `asset-${hasher.digest()}`,
      kind,
      mime: 'image/svg+xml',
      width,
      height,
      bytes,
    });
  }
  return assets;
}
