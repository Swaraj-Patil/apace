// The page tree as columns in one buffer, so the worker can hand the whole tree to the main
// thread by transfer rather than by copying thousands of objects. The layout:
//
//   u32 version, u32 row count, u32 string bytes,
//   i32 parent row per row, u16 depth per row, u8 flags per row,
//   then UTF-8 JSON: every id, then every title, then every icon (null when unset).

/** The page or one of its ancestors is in the trash. */
export const IN_TRASH = 1;
/** The page itself was put in the trash. */
export const TRASHED = 2;

const VERSION = 1;
const HEADER = 12;

export interface TreeRow {
  readonly id: string;
  /** The parent's id, or null at the top level. A parent always comes before its children. */
  readonly parent: string | null;
  readonly depth: number;
  readonly flags: number;
  readonly title: string;
  readonly icon: string | null;
}

/** Rows in display order: parents before children, siblings in order. */
export interface TreeColumns {
  readonly count: number;
  readonly ids: readonly string[];
  readonly titles: readonly string[];
  readonly icons: readonly (string | null)[];
  /** Each row's parent as a row number, or -1 at the top level. */
  readonly parents: Int32Array;
  readonly depths: Uint16Array;
  readonly flags: Uint8Array;
}

export function encodeTree(rows: readonly TreeRow[]): ArrayBuffer {
  const count = rows.length;
  const position = new Map<string, number>();
  const strings = JSON.stringify([
    ...rows.map((row) => row.id),
    ...rows.map((row) => row.title),
    ...rows.map((row) => row.icon),
  ]);
  const text = new TextEncoder().encode(strings);
  const buffer = new ArrayBuffer(HEADER + count * 7 + text.byteLength);
  new Uint32Array(buffer, 0, 3).set([VERSION, count, text.byteLength]);
  const parents = new Int32Array(buffer, HEADER, count);
  const depths = new Uint16Array(buffer, HEADER + count * 4, count);
  const flags = new Uint8Array(buffer, HEADER + count * 6, count);
  rows.forEach((row, index) => {
    const parent = row.parent === null ? -1 : position.get(row.parent);
    if (parent === undefined) throw new Error(`${row.id} comes before its parent ${row.parent}`);
    parents[index] = parent;
    depths[index] = row.depth;
    flags[index] = row.flags;
    position.set(row.id, index);
  });
  new Uint8Array(buffer, HEADER + count * 7).set(text);
  return buffer;
}

export function decodeTree(buffer: ArrayBuffer): TreeColumns {
  const [version = 0, count = 0, textBytes = 0] = new Uint32Array(buffer, 0, 3);
  if (version !== VERSION) throw new Error(`Unknown tree format ${version}`);
  const text = new Uint8Array(buffer, HEADER + count * 7, textBytes);
  const strings = JSON.parse(new TextDecoder().decode(text)) as (string | null)[];
  return {
    count,
    ids: strings.slice(0, count) as string[],
    titles: strings.slice(count, count * 2) as string[],
    icons: strings.slice(count * 2),
    parents: new Int32Array(buffer, HEADER, count),
    depths: new Uint16Array(buffer, HEADER + count * 4, count),
    flags: new Uint8Array(buffer, HEADER + count * 6, count),
  };
}
