// One page's title and blocks, drawn from that page's own stream.
import {
  type Block,
  type BlockType,
  type Inline,
  type Marks,
  makeBlock,
  type Page,
} from '@apace/model';
import type { SeedAsset } from './assets.ts';
import { HUB_EVERY, type WorkspacePlan } from './plan.ts';
import { idFrom, type Random, stream } from './random.ts';
import { ADJECTIVES, CALLOUT_ICONS, CODE_LINES, LANGUAGES, NOUNS, VERBS } from './words.ts';

/** Embeds point at a fixed local origin, so even a failed load never leaves the machine. */
export const EMBED_ORIGIN = 'http://localhost:4312';
/** How many embed pages that origin has to offer, at `/embed/1.html` through `/embed/N.html`. */
export const EMBED_PAGES = 12;
/** Links use a domain reserved for examples. Nothing follows them unless someone clicks. */
export const LINK_ORIGIN = 'https://example.com';

/** The Phase 1 block mix, as relative weights. */
export const BLOCK_MIX: readonly (readonly [BlockType, number])[] = [
  ['paragraph', 46],
  ['heading', 10],
  ['bulleted', 12],
  ['numbered', 6],
  ['todo', 7],
  ['toggle', 4],
  ['quote', 2],
  ['callout', 3],
  ['divider', 2],
  ['code', 4],
  ['image', 2],
  ['embed', 1],
];

/** The 3,000-block page leans on the blocks that cost the most to show. */
const LARGE_MIX: readonly (readonly [BlockType, number])[] = [
  ['paragraph', 38],
  ['heading', 8],
  ['bulleted', 12],
  ['numbered', 6],
  ['todo', 6],
  ['toggle', 8],
  ['quote', 2],
  ['callout', 4],
  ['divider', 2],
  ['code', 8],
  ['image', 4],
  ['embed', 2],
];

const MARKS: readonly (readonly [keyof Marks, number])[] = [
  ['bold', 35],
  ['italic', 25],
  ['inlineCode', 15],
  ['link', 15],
  ['underline', 5],
  ['strike', 5],
];

const HEADING_LEVELS = [
  [1, 2],
  [2, 5],
  [3, 3],
] as const;

/** How a list item's indent changes from the item before. */
const INDENT_STEPS = [
  [-1, 2],
  [0, 5],
  [1, 3],
] as const;

const LINKERS = ['before', 'after', 'with', 'for', 'during', 'without'] as const;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function phrase(random: Random): string {
  return capitalize(`${random.pick(ADJECTIVES)} ${random.pick(NOUNS)}`);
}

export function pageTitle(random: Random, planted: string | null): string {
  if (planted !== null) return `${planted} ${random.pick(NOUNS)} ${random.pick(NOUNS)}`;
  switch (random.int(0, 2)) {
    case 0:
      return phrase(random);
    case 1:
      return capitalize(`${random.pick(NOUNS)} ${random.pick(NOUNS)}`);
    default:
      return `${phrase(random)} ${random.pick(NOUNS)}`;
  }
}

function marks(random: Random): Marks {
  const mark = random.weighted(MARKS);
  if (mark === 'link') return { link: { href: `${LINK_ORIGIN}/${random.pick(NOUNS)}` } };
  return { [mark]: true };
}

/** The page at `index`. It reads only the plan, so any page can be generated alone. */
export function pageContent(plan: WorkspacePlan, index: number): Page {
  const info = plan.pages[index];
  if (info === undefined) throw new Error(`There is no page ${index}`);
  const random = stream(plan.seed, 'page', index);
  const title = pageTitle(random, info.planted);
  const large = index === plan.large;
  const images: readonly SeedAsset[] = plan.assets.filter((asset) => asset.kind === 'image');
  const blocks: Block[] = [];
  const ids = new Set<string>();

  const add = (type: BlockType, indent: number, attrs: object, content: Inline[]) => {
    let id: string;
    do id = idFrom(random, 12);
    while (ids.has(id));
    ids.add(id);
    blocks.push(makeBlock(type, id, { indent, attrs: { ...attrs }, content }));
  };

  // Mentions lean on the hubs, so the hubs gather backlinks.
  const mention = (): string | null => {
    if (!random.chance(large ? 0.1 : 0.04)) return null;
    const target = random.pick(random.chance(0.5) ? plan.hubs : plan.mentionable);
    return target === index ? null : (plan.pages[target]?.id ?? null);
  };

  /** One to `max` sentences, some with marks or a mention. */
  const text = (max: number): Inline[] => {
    const parts: Inline[] = [];
    const sentences = random.int(1, max);
    for (let s = 0; s < sentences; s++) {
      if (s > 0) parts.push({ text: ' ' });
      parts.push({ text: `${capitalize(random.pick(VERBS))} the ` });
      const object = `${random.pick(ADJECTIVES)} ${random.pick(NOUNS)}`;
      parts.push(random.chance(0.15) ? { text: object, marks: marks(random) } : { text: object });
      if (random.chance(0.6)) {
        parts.push({
          text: ` ${random.pick(LINKERS)} the ${random.pick(NOUNS)} ${random.pick(NOUNS)}`,
        });
      }
      const target = mention();
      if (target !== null) parts.push({ text: ' (see ' }, { mention: target }, { text: ')' });
      parts.push({ text: '.' });
    }
    return parts;
  };

  const code = (indent: number) => {
    const start = random.int(0, CODE_LINES.length - 1);
    const lines = Array.from(
      { length: random.int(1, 6) },
      (_, n) => CODE_LINES[(start + n) % CODE_LINES.length],
    );
    add('code', indent, { language: random.pick(LANGUAGES) }, [{ text: lines.join('\n') }]);
  };

  /** Writes one block, or a run of related blocks: list items, or a toggle and its children. */
  const group = (type: BlockType) => {
    switch (type) {
      case 'heading':
        add('heading', 0, { level: random.weighted(HEADING_LEVELS) }, [{ text: phrase(random) }]);
        return;
      case 'bulleted':
      case 'numbered':
      case 'todo': {
        // Items nest at most one level deeper than the item before, and at most two deep.
        let indent = 0;
        const items = random.int(2, 6);
        for (let n = 0; n < items; n++) {
          if (n > 0) indent = Math.max(0, Math.min(2, indent + random.weighted(INDENT_STEPS)));
          add(type, indent, type === 'todo' ? { checked: random.chance(0.4) } : {}, text(1));
        }
        return;
      }
      case 'toggle': {
        add('toggle', 0, {}, text(1));
        const children = random.int(1, 3);
        for (let n = 0; n < children; n++) {
          if (random.chance(0.2)) code(1);
          else add(random.chance(0.7) ? 'paragraph' : 'bulleted', 1, {}, text(2));
        }
        return;
      }
      case 'callout':
        add('callout', 0, { icon: random.pick(CALLOUT_ICONS) }, text(2));
        return;
      case 'divider':
        add('divider', 0, {}, []);
        return;
      case 'code':
        code(0);
        return;
      case 'image': {
        const image = random.pick(images);
        const size = { width: image.width, height: image.height };
        add('image', 0, { asset: image.id, alt: phrase(random), ...size }, []);
        return;
      }
      case 'embed': {
        const url = `${EMBED_ORIGIN}/embed/${random.int(1, EMBED_PAGES)}.html`;
        add('embed', 0, { url, height: random.pick([360, 480]) }, []);
        return;
      }
      default:
        add(type, 0, {}, text(type === 'paragraph' ? 4 : 2));
    }
  };

  const hub = plan.hubs[0];
  if (hub !== undefined && index % HUB_EVERY === 0 && index !== hub) {
    add('paragraph', 0, {}, [{ text: 'Part of ' }, { mention: plan.pages[hub]?.id ?? '' }]);
  }
  const mix = large ? LARGE_MIX : BLOCK_MIX;
  while (blocks.length < info.blockCount) group(random.weighted(mix));

  return {
    title,
    meta: { icon: info.icon, cover: info.cover, fullWidth: info.fullWidth },
    blocks: blocks.slice(0, info.blockCount),
  };
}
