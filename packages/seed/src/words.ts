// Word lists for generated text. The planted words appear only in the titles of the pages that
// carry them, and no other word shares their first four letters, so a search for one, or for
// its prefix, has exactly one right answer.

/** A comma-separated list, so long word lists stay compact. */
function list(words: string): readonly string[] {
  return words.trim().split(/\s*,\s*/);
}

export const PLANTED = [
  'Zephyr',
  'Quokka',
  'Marzipan',
  'Tundra',
  'Halcyon',
  'Juniper',
  'Saffron',
  'Basalt',
  'Obsidian',
  'Kestrel',
  'Nimbus',
  'Wombat',
] as const;

export const NOUNS = list(`
  roadmap, plan, review, release, process, budget, launch, research, design, meeting, notes,
  sprint, retro, goals, metrics, onboarding, handbook, policy, checklist, timeline, proposal,
  brief, spec, interview, hiring, pricing, customer, feedback, partner, contract, invoice, report,
  quarter, offsite, workshop, migration, incident, postmortem, architecture, database, schema,
  api, endpoint, deploy, pipeline, benchmark, cache, index, search, sync, worker, editor, sidebar,
  theme, token, palette, layout, grid, typography, icon, cover, page, block, toggle, callout,
  mention, backlink, template, export, import, dashboard, survey, persona, journey, funnel,
  cohort, experiment, hypothesis, backlog, estimate, milestone, dependency, risk, decision,
  tradeoff, prototype, mockup, wireframe, flow, screen, component, library, package, module,
  service, queue, job, cron, alert, monitor, log, trace, profile, memory, latency, throughput,
  storage, quota, backup, restore, archive, permission, role, member, team, guild, chapter, squad,
  standup, demo, changelog, announcement, newsletter, blog, article, guide, tutorial, recipe,
  glossary, faq, vendor, license, audit, compliance, security, privacy, accessibility, contrast,
  keyboard, focus, motion, locale, translation, calendar, agenda, minutes, summary, outline,
  draft, appendix, reference
`);

export const VERBS = list(`
  ship, review, plan, draft, test, measure, fix, refactor, document, migrate, deploy, profile,
  design, write, schedule, prepare, publish, update, remove, rename, split, merge, tune, cache,
  index, trace, audit, rotate, archive, triage, estimate, prioritize, sketch, prototype, validate,
  interview, survey, summarize, translate, localize, benchmark, monitor, alert, backfill, compact,
  simplify, clarify, unblock, escalate, onboard, hand off, sign off, follow up
`);

export const ADJECTIVES = list(`
  quarterly, weekly, final, shared, internal, public, legacy, new, fast, critical, minor, major,
  open, closed, pending, urgent, quiet, careful, visible, local, remote, offline, stable, early,
  late, small, large, clear, simple, dense, calm, precise, rough, proposed, accepted, rejected,
  annual, monthly, daily, regional, global, primary, secondary, optional, required
`);

export const CODE_LINES = [
  'const page = await store.loadDoc(pageId);',
  'pnpm bench --trace',
  'SELECT id, title FROM pages WHERE parent_id = ?;',
  'export function measure(name: string): void {',
  "  performance.mark(name + ':start');",
  '}',
  'for (const block of page.blocks) render(block);',
  'git switch -c release/2.4',
  '{ "budget": 100, "stat": "p95" }',
  'curl -s https://example.com/health | jq .status',
  'if (latency > budget) throw new Error("over budget");',
  'def summarize(rows): return sum(r.estimate for r in rows)',
  'func handle(w http.ResponseWriter, r *http.Request) {}',
  '.sidebar { width: 232px; }',
  '<button type="button">Use it here</button>',
  'let total = items.iter().map(|i| i.size).sum::<usize>();',
];

export const LANGUAGES = list('ts, js, sql, sh, json, css, html, python, go, rust');
/** Page icons are emoji until the icon picker adds its own glyphs. */
export const PAGE_ICONS = list('🚀, 🌿, 📘, 🚩, ⚙️, 📈, ✏️, ⭐, ⚡, 🗺️');
export const CALLOUT_ICONS = list('note, warning, idea, check');
export const TAGS = list(`
  frontend, backend, design, research, infra, docs, bug, perf, a11y, security, mobile, growth
`);

export const FIRST_NAMES = list(`
  Ada, Ben, Chen, Dara, Eli, Farah, Gus, Hana, Ivo, Jun, Kai, Lena, Mo, Nia, Omar, Priya, Quinn,
  Rosa, Sam, Tomas, Uma, Vik, Wen, Xia, Yara, Zoe, Ari, Bea, Cyd, Dev, Esme, Finn, Gia, Hugo,
  Isla, Joss, Kira, Leo, Maya, Noor
`);

export const LAST_NAMES = list(`
  Okafor, Lindqvist, Moreau, Tanaka, Haddad, Novak, Reyes, Kowalski, Mensah, Larsen, Duarte,
  Ivanova, Chaudhry, Fischer, Nakamura, Oyelaran, Petrov, Quispe, Rossi, Sato, Teller, Underwood,
  Varga, Weiss, Xu, Yilmaz, Zielinski, Abbott, Bauer, Castillo, Dimitrov, Eklund, Forde, Gallo,
  Holm, Ishikawa, Jensen, Kaur, Lopes, Molina
`);
