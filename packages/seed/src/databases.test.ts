import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  databasesHash,
  HEALTHS,
  healthOf,
  openBlockersOf,
  PERSON_COUNT,
  PROJECT_COUNT,
  type SeedDatabases,
  STATUSES,
  seedDatabases,
  TASK_COUNT,
  TASK_PROPERTIES,
  type Task,
} from './databases.ts';
import { TAGS } from './words.ts';

let databases: SeedDatabases;

beforeAll(() => {
  databases = seedDatabases(1);
});

describe('the databases', () => {
  test('have exactly 50,000 tasks with the 15 properties, 500 projects and 40 people', () => {
    expect(TASK_PROPERTIES).toHaveLength(15);
    const keys = ['id', ...TASK_PROPERTIES.map((property) => property.key)].sort();
    expect(new Set(keys).size).toBe(16);
    expect(databases.tasks).toHaveLength(TASK_COUNT);
    const shapes = new Set(databases.tasks.map((task) => Object.keys(task).sort().join()));
    expect([...shapes]).toEqual([keys.join()]);
    expect(databases.projects).toHaveLength(PROJECT_COUNT);
    expect(databases.people).toHaveLength(PERSON_COUNT);
  });

  test('point every relation, owner and contact at something that exists', () => {
    const { people, projects, tasks } = databases;
    const personIds = new Set(people.map((person) => person.id));
    const emails = new Set(people.map((person) => person.email));
    const projectIds = new Set(projects.map((project) => project.id));
    const position = new Map(tasks.map((task, index) => [task.id, index]));
    expect(personIds.size).toBe(PERSON_COUNT);
    expect(projectIds.size).toBe(PROJECT_COUNT);
    expect(position.size).toBe(TASK_COUNT);

    const problems: string[] = [];
    for (const project of projects) {
      if (!personIds.has(project.owner)) problems.push(`${project.id} has no owner`);
    }
    tasks.forEach((task, index) => {
      if (task.owner !== null && !personIds.has(task.owner)) problems.push(`${task.id} owner`);
      if (task.contact !== null && !emails.has(task.contact)) problems.push(`${task.id} contact`);
      if (task.project !== null && !projectIds.has(task.project))
        problems.push(`${task.id} project`);
      if (new Set(task.blockedBy).size !== task.blockedBy.length)
        problems.push(`${task.id} repeats`);
      for (const blocker of task.blockedBy) {
        // Blockers come earlier, so Blocked by never forms a cycle.
        if (!((position.get(blocker) ?? Infinity) < index)) problems.push(`${task.id} blocker`);
      }
    });
    expect(problems).toEqual([]);
    expect(tasks.filter((task) => task.blockedBy.length > 0).length).toBeGreaterThan(10_000);
  });

  test('keep every value in its property’s domain', () => {
    const problems: string[] = [];
    const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
    for (const task of databases.tasks) {
      if (!STATUSES.includes(task.status)) problems.push(`${task.id} status`);
      if (task.done !== (task.status === 'Done')) problems.push(`${task.id} done`);
      if (task.due !== null && !isDate(task.due)) problems.push(`${task.id} due`);
      if (new Set(task.tags).size !== task.tags.length) problems.push(`${task.id} tags repeat`);
      if (!task.tags.every((tag) => (TAGS as readonly string[]).includes(tag)))
        problems.push(`${task.id} tag`);
      if (task.spent < 0 || (task.estimate !== null && task.estimate <= 0))
        problems.push(`${task.id} hours`);
    }
    for (const project of databases.projects) {
      if (!isDate(project.start) || !(project.start < project.target))
        problems.push(`${project.id} dates`);
    }
    expect(problems).toEqual([]);
  });

  test('hold rollup and formula values that match the reference functions', () => {
    const byId = new Map(databases.tasks.map((task) => [task.id, task]));
    const wrong = databases.tasks.filter((task) => {
      const open = openBlockersOf(task, byId);
      return task.openBlockers !== open || task.health !== healthOf(task, open);
    });
    expect(wrong).toEqual([]);
  });

  test('reach every status and every health value', () => {
    expect(new Set(databases.tasks.map((task) => task.status))).toEqual(new Set(STATUSES));
    expect(new Set(databases.tasks.map((task) => task.health))).toEqual(new Set(HEALTHS));
  });
});

describe('the reference functions', () => {
  const task = (fields: Partial<Task>): Task => ({
    id: 't',
    title: 'Task',
    status: 'In progress',
    priority: 'Medium',
    tags: [],
    owner: null,
    due: null,
    estimate: null,
    spent: 0,
    done: false,
    link: null,
    contact: null,
    project: null,
    blockedBy: [],
    openBlockers: 0,
    health: 'On track',
    ...fields,
  });

  test('count only the blockers that are not done', () => {
    const tasks = new Map([
      ['a', task({ id: 'a', done: true })],
      ['b', task({ id: 'b' })],
      ['c', task({ id: 'c' })],
    ]);
    expect(openBlockersOf(task({ blockedBy: [] }), tasks)).toBe(0);
    expect(openBlockersOf(task({ blockedBy: ['a'] }), tasks)).toBe(0);
    expect(openBlockersOf(task({ blockedBy: ['a', 'b', 'c'] }), tasks)).toBe(2);
  });

  test('take the first health rule that holds', () => {
    const late = { due: '2026-05-31', estimate: 2, spent: 3 };
    expect(healthOf(task({ ...late, done: true }), 1)).toBe('Done');
    expect(healthOf(task(late), 1)).toBe('Blocked');
    expect(healthOf(task(late), 0)).toBe('Overdue');
    expect(healthOf(task({ ...late, due: '2026-06-01' }), 0)).toBe('Over budget');
    expect(healthOf(task({ due: null, estimate: null, spent: 40 }), 0)).toBe('On track');
    expect(healthOf(task({ estimate: 3, spent: 3 }), 0)).toBe('On track');
    expect(healthOf(task({ due: '2026-06-02' }), 0, '2026-06-03')).toBe('Overdue');
  });
});

describe('generation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('gives the same hash for the same seed', () => {
    const hash = databasesHash(databases);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(databasesHash(seedDatabases(1))).toBe(hash);
  });

  test('gives a different hash for another seed', () => {
    expect(databasesHash(seedDatabases(2))).not.toBe(databasesHash(databases));
  });

  test('never reads the clock or Math.random', () => {
    const random = vi.spyOn(Math, 'random');
    const now = vi.spyOn(Date, 'now');
    seedDatabases(3);
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });
});
