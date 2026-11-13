// Test support: the projection tables as plain rows, keyed by what they describe rather than
// by row number, and the ways the tables can disagree with each other or with the log.
import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm';

export interface ProjectionDump {
  readonly pages: SqlValue[][];
  readonly blocks: SqlValue[][];
  readonly links: SqlValue[][];
  readonly search: SqlValue[][];
}

export function dumpProjections(db: Database): ProjectionDump {
  return {
    pages: db.selectArrays(
      `SELECT id, parent, ord, idx, depth, preorder, trashed, trashed_at, repair, created, title,
         icon, cover, full_width FROM pages ORDER BY id`,
    ),
    blocks: db.selectArrays(
      'SELECT page_id, id, idx, type, indent, attrs, content, text FROM blocks ORDER BY page_id, id',
    ),
    links: db.selectArrays(
      'SELECT source, block, target FROM links ORDER BY source, block, target',
    ),
    search: db.selectArrays(
      'SELECT p.id, s.title, s.body FROM search s JOIN pages p ON p.num = s.rowid ORDER BY p.id',
    ),
  };
}

/** Every inconsistency between the tables, or between them and the log. Empty when there's none. */
export function projectionProblems(db: Database): string[] {
  const problems: string[] = [];
  const count = (sql: string) => Number(db.selectValue(sql));
  const checks: [string, string][] = [
    [
      'search rows without a page',
      'SELECT count(*) FROM search WHERE rowid NOT IN (SELECT num FROM pages)',
    ],
    [
      'pages without a search row',
      'SELECT count(*) FROM pages WHERE num NOT IN (SELECT rowid FROM search)',
    ],
    [
      'blocks of no page',
      'SELECT count(*) FROM blocks WHERE page_id NOT IN (SELECT id FROM pages)',
    ],
    ['links from no page', 'SELECT count(*) FROM links WHERE source NOT IN (SELECT id FROM pages)'],
    [
      'links from no block',
      'SELECT count(*) FROM links l WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE b.page_id = l.source AND b.id = l.block)',
    ],
    ['docs not projected', 'SELECT count(*) FROM docs WHERE projected_seq < last_seq'],
  ];
  for (const [name, sql] of checks) {
    const found = count(sql);
    if (found > 0) problems.push(`${found} ${name}`);
  }
  try {
    db.exec("INSERT INTO search (search) VALUES ('integrity-check')");
  } catch (error) {
    problems.push(`the search index fails its check: ${String(error)}`);
  }
  return problems;
}
