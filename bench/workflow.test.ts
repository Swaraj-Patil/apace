// The workflow can only be run by GitHub, so what can be checked here is that it stays in step
// with the repository: the runner the budgets name, the versions this repository pins, and the
// commands a run has to include.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { readBudgets } from './budgets.ts';

const WORKFLOW = fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url));
const workflow = await readFile(WORKFLOW, 'utf8');

describe('the CI workflow', () => {
  test('runs on the runner the budgets were set for', async () => {
    const budgets = await readBudgets();
    expect(workflow).toContain(`runs-on: ${budgets.ci.runner}`);
    // Never a moving label: a runner that changed under us would move every number with it.
    expect(workflow).not.toContain('ubuntu-latest');
  });

  test('checks out the history the A/B run needs', () => {
    expect(workflow).toContain('fetch-depth: 0');
  });

  test('runs every command, and the gate', () => {
    for (const command of [
      'pnpm check',
      'pnpm test',
      'pnpm e2e',
      'node bench/run.ts',
      'node bench/ab.ts',
      'node bench/gate.ts',
    ]) {
      expect(workflow, command).toContain(command);
    }
  });

  test('asks bench/ci.ts what to run rather than deciding in YAML', () => {
    expect(workflow).toContain('node bench/ci.ts');
  });

  test('pins every action to an exact version', () => {
    const used = [...workflow.matchAll(/uses: (\S+)/g)].map(([, action]) => action);
    expect(used.length).toBeGreaterThan(0);
    for (const action of used) {
      expect(action, action).toMatch(/@v\d+\.\d+\.\d+$/);
    }
  });

  test('keeps the reports whether the run passed or failed', () => {
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('bench/results/');
  });
});
