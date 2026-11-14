import { describe, expect, test } from 'vitest';
import { baseRef, gateWanted, harnessRef, phaseOf, planComplete, planFor } from './ci.ts';

const plan = (steps: string) => `# A plan\n\n## Steps\n\n${steps}\n\n### 1. Something\n`;

describe('which phase a branch is on', () => {
  test('reads it from the branch name', () => {
    expect(phaseOf('phase-1')).toBe(1);
    expect(phaseOf('phase-12')).toBe(12);
  });

  test('is nothing for a branch that names none', () => {
    for (const branch of ['main', 'phase-', 'phase-1-fix', 'Phase-1', 'HEAD']) {
      expect(phaseOf(branch), branch).toBeNull();
    }
  });
});

describe('whether a plan is finished', () => {
  test('is true when every step is ticked', () => {
    expect(planComplete(plan('- [x] 1. One\n- [x] 2. Two'))).toBe(true);
  });

  test('is false while any step is open', () => {
    expect(planComplete(plan('- [x] 1. One\n- [ ] 2. Two'))).toBe(false);
    expect(planComplete(plan('- [ ] 1. One'))).toBe(false);
  });

  test('is false for a document with no checklist at all', () => {
    expect(planComplete('# A plan\n\nNo steps here.\n')).toBe(false);
  });
});

describe('what CI runs', () => {
  test('the gate, once a phase branch has every step ticked', () => {
    expect(gateWanted('phase-1', plan('- [x] 1. One'))).toBe(true);
  });

  test('the commands, while the phase has steps left', () => {
    expect(gateWanted('phase-1', plan('- [x] 1. One\n- [ ] 2. Two'))).toBe(false);
  });

  test('the commands, on a branch with no plan', () => {
    expect(gateWanted('main', null)).toBe(false);
    expect(gateWanted('main', plan('- [x] 1. One'))).toBe(false);
  });

  test('this repository, read from disk, is on a phase with steps left', async () => {
    const here = await planFor('phase-1');
    expect(here).not.toBeNull();
    expect(gateWanted('phase-1', here)).toBe(planComplete(here ?? ''));
    expect(await planFor('main')).toBeNull();
  });
});

describe('what the A/B run compares against', () => {
  test('finds the first ref that holds the harness', async () => {
    expect(await harnessRef(['no-such-ref-here', 'HEAD'])).toBe('HEAD');
    expect(await harnessRef(['HEAD'], 'bench/not-a-file.json')).toBeNull();
    expect(await harnessRef([])).toBeNull();
  });

  test('is a ref that exists, and the previous commit while main has no harness', async () => {
    const base = await baseRef();
    const mainHasIt = (await harnessRef(['main', 'origin/main'])) !== null;
    expect(base).toBe(mainHasIt ? ((await harnessRef(['main', 'origin/main'])) ?? '') : 'HEAD~1');
  });
});
