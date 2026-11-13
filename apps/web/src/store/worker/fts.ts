// Text for the FTS5 search table, and queries against it. Both sides split words the way
// FTS5's unicode61 tokenizer does: letters, numbers and private-use characters make up words,
// and everything else separates them.

const WORD = /[\p{L}\p{N}\p{Co}]+/gu;
/** More words than this add nothing a person would type, so the rest are ignored. */
const MAX_WORDS = 16;

/** Composes accented letters, so a decomposed accent can't split a word in two. */
export function searchable(text: string): string {
  return text.normalize('NFC');
}

/**
 * The FTS5 query for what someone typed, or null when it has no words. Each word becomes a
 * quoted prefix term, so FTS5's own syntax (AND, NEAR, quotes, stars) is only searched for as
 * text, and every word must match.
 */
export function matchQuery(typed: string): string | null {
  const words = searchable(typed).match(WORD);
  if (words === null) return null;
  return words
    .slice(0, MAX_WORDS)
    .map((word) => `"${word}"*`)
    .join(' ');
}
