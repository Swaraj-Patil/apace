// The databases Phase 2 stores: tasks, the projects they belong to, and the people who own
// them. They're generated and checked now, so Phase 2's spike can try Yjs layouts against
// fixed data. The rollup and the formula come from the plain reference functions below, which
// Phase 2's engine must agree with.
import { createHasher } from './hash.ts';
import { DAY, EPOCH } from './plan.ts';
import { idFrom, type Random, stream } from './random.ts';
import { ADJECTIVES, FIRST_NAMES, LAST_NAMES, NOUNS, TAGS, VERBS } from './words.ts';

export const TASK_COUNT = 50_000;
export const PROJECT_COUNT = 500;
export const PERSON_COUNT = 40;
/** The day the formula treats as today, so a task's health never depends on the clock. */
export const TODAY = '2026-06-01';

export const STATUSES = ['Not started', 'In progress', 'Blocked', 'Done'] as const;
export const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'] as const;
export const HEALTHS = ['Done', 'Blocked', 'Overdue', 'Over budget', 'On track'] as const;
export const PROJECT_STATUSES = ['Planned', 'Active', 'Paused', 'Done'] as const;
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Health = (typeof HEALTHS)[number];

export type PropertyType =
  | 'title'
  | 'select'
  | 'multiSelect'
  | 'person'
  | 'date'
  | 'number'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'relation'
  | 'rollup'
  | 'formula';

export interface Property {
  readonly key: keyof Omit<Task, 'id'>;
  readonly name: string;
  readonly type: PropertyType;
}

export const TASK_PROPERTIES: readonly Property[] = [
  { key: 'title', name: 'Title', type: 'title' },
  { key: 'status', name: 'Status', type: 'select' },
  { key: 'priority', name: 'Priority', type: 'select' },
  { key: 'tags', name: 'Tags', type: 'multiSelect' },
  { key: 'owner', name: 'Owner', type: 'person' },
  { key: 'due', name: 'Due', type: 'date' },
  { key: 'estimate', name: 'Estimate', type: 'number' },
  { key: 'spent', name: 'Spent', type: 'number' },
  { key: 'done', name: 'Done', type: 'checkbox' },
  { key: 'link', name: 'Link', type: 'url' },
  { key: 'contact', name: 'Contact', type: 'email' },
  { key: 'project', name: 'Project', type: 'relation' },
  { key: 'blockedBy', name: 'Blocked by', type: 'relation' },
  { key: 'openBlockers', name: 'Open blockers', type: 'rollup' },
  { key: 'health', name: 'Health', type: 'formula' },
];

export interface Person {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly status: (typeof PROJECT_STATUSES)[number];
  /** ISO dates. */
  readonly start: string;
  readonly target: string;
}

export interface Task {
  readonly id: string;
  readonly title: string;
  readonly status: Status;
  readonly priority: Priority;
  readonly tags: readonly string[];
  /** A person's id. */
  readonly owner: string | null;
  /** An ISO date. */
  readonly due: string | null;
  /** Hours. */
  readonly estimate: number | null;
  /** Hours. */
  readonly spent: number;
  readonly done: boolean;
  readonly link: string | null;
  readonly contact: string | null;
  /** A project's id. */
  readonly project: string | null;
  /** Ids of earlier tasks, so the relation never forms a cycle. */
  readonly blockedBy: readonly string[];
  /** Rollup: how many of the tasks in Blocked by aren't done. */
  readonly openBlockers: number;
  /** Formula: see `healthOf`. */
  readonly health: Health;
}

export interface SeedDatabases {
  readonly people: readonly Person[];
  readonly projects: readonly Project[];
  readonly tasks: readonly Task[];
}

/** The Open blockers rollup: the tasks in Blocked by that aren't done. */
export function openBlockersOf(
  task: Pick<Task, 'blockedBy'>,
  tasks: ReadonlyMap<string, Pick<Task, 'done'>>,
): number {
  return task.blockedBy.filter((id) => tasks.get(id)?.done === false).length;
}

/** The Health formula. The first rule that holds wins. */
export function healthOf(
  task: Pick<Task, 'done' | 'due' | 'estimate' | 'spent'>,
  openBlockers: number,
  today: string = TODAY,
): Health {
  if (task.done) return 'Done';
  if (openBlockers > 0) return 'Blocked';
  if (task.due !== null && task.due < today) return 'Overdue';
  if (task.estimate !== null && task.spent > task.estimate) return 'Over budget';
  return 'On track';
}

function isoDate(dayOffset: number): string {
  return new Date(EPOCH + dayOffset * DAY).toISOString().slice(0, 10);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function distinct<T>(random: Random, items: readonly T[], count: number): T[] {
  const chosen = new Set<T>();
  while (chosen.size < count) chosen.add(random.pick(items));
  return [...chosen];
}

function uniqueIds(random: Random, count: number): string[] {
  const ids = new Set<string>();
  while (ids.size < count) ids.add(idFrom(random, 16));
  return [...ids];
}

export function seedDatabases(seed: number): SeedDatabases {
  const random = stream(seed, 'people');
  const people = uniqueIds(stream(seed, 'person-ids'), PERSON_COUNT).map((id, n): Person => {
    const first = FIRST_NAMES[n % FIRST_NAMES.length] ?? 'Ada';
    const last = random.pick(LAST_NAMES);
    return { id, name: `${first} ${last}`, email: `${first}.${last}@example.com`.toLowerCase() };
  });
  const personIds = people.map((person) => person.id);

  const projectRandom = stream(seed, 'projects');
  const projects = uniqueIds(stream(seed, 'project-ids'), PROJECT_COUNT).map((id): Project => {
    const start = projectRandom.int(-120, 200);
    return {
      id,
      name: capitalize(`${projectRandom.pick(ADJECTIVES)} ${projectRandom.pick(NOUNS)}`),
      owner: projectRandom.pick(personIds),
      status: projectRandom.weighted([
        ['Planned', 2],
        ['Active', 5],
        ['Paused', 1],
        ['Done', 2],
      ] as const),
      start: isoDate(start),
      target: isoDate(start + projectRandom.int(14, 180)),
    };
  });

  const taskRandom = stream(seed, 'tasks');
  const taskIds = uniqueIds(stream(seed, 'task-ids'), TASK_COUNT);
  const byProject = new Map<number, number[]>();
  const tasks: Task[] = [];
  const byId = new Map<string, Task>();
  for (let n = 0; n < TASK_COUNT; n++) {
    const r = taskRandom;
    const status = r.weighted([
      ['Not started', 30],
      ['In progress', 25],
      ['Blocked', 10],
      ['Done', 35],
    ] as const);
    const estimate = r.chance(0.2) ? null : r.pick([1, 2, 3, 5, 8, 13, 21]);
    const spent = status === 'Not started' ? 0 : Math.round(r.next() * 3 * (estimate ?? 10)) / 2;
    const projectIndex = r.chance(0.03) ? null : r.int(0, PROJECT_COUNT - 1);

    // Blockers are earlier tasks, mostly from the same project.
    const blockers = r.weighted([
      [0, 70],
      [1, 20],
      [2, 8],
      [3, 2],
    ] as const);
    const siblings = projectIndex === null ? [] : (byProject.get(projectIndex) ?? []);
    const blockedBy = new Set<string>();
    for (let b = 0; b < blockers && n > 0; b++) {
      const index = siblings.length > 0 && r.chance(0.8) ? r.pick(siblings) : r.int(0, n - 1);
      blockedBy.add(taskIds[index] ?? '');
    }
    if (projectIndex !== null) byProject.set(projectIndex, [...siblings, n]);

    const contact = r.chance(0.4) ? r.pick(people).email : null;
    const fields = {
      id: taskIds[n] ?? '',
      title: capitalize(`${r.pick(VERBS)} the ${r.pick(ADJECTIVES)} ${r.pick(NOUNS)}`),
      status,
      priority: r.weighted([
        ['Urgent', 5],
        ['High', 20],
        ['Medium', 45],
        ['Low', 30],
      ] as const),
      tags: distinct(
        r,
        TAGS,
        r.weighted([
          [0, 3],
          [1, 4],
          [2, 2],
          [3, 1],
        ] as const),
      ),
      owner: r.chance(0.92) ? r.pick(personIds) : null,
      due: r.chance(0.15) ? null : isoDate(r.int(-30, 300)),
      estimate,
      spent,
      done: status === 'Done',
      link: r.chance(0.3) ? `https://example.com/tasks/${n + 1}` : null,
      contact,
      project: projectIndex === null ? null : (projects[projectIndex]?.id ?? null),
      blockedBy: [...blockedBy],
    };
    const openBlockers = openBlockersOf(fields, byId);
    const task: Task = { ...fields, openBlockers, health: healthOf(fields, openBlockers) };
    tasks.push(task);
    byId.set(task.id, task);
  }
  return { people, projects, tasks };
}

/** A hash of every row, in order. */
export function databasesHash(databases: SeedDatabases): string {
  const hasher = createHasher();
  for (const table of [databases.people, databases.projects, databases.tasks]) {
    for (const row of table) hasher.updateText(`${JSON.stringify(row)}\n`);
  }
  return hasher.digest();
}
